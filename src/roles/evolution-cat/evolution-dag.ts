import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ArenaManager, fingerprintArenaDirectory } from '../../arena/arena-manager';
import { executeArenaRun } from '../../arena/arena-runner';
import { verifyPromotionReceiptRawEvidence } from '../../arena/evolution-promotion';
import { SubAgentSession } from '../../core/sub-agent-session';
import { SkillManager } from '../../skills/skill-manager';
import { SkillParser } from '../../skills/skill-parser';
import { AIService } from '../../utils/ai-service';
import {
  BuildEvolutionDigestResult,
  EvolutionDigest,
  buildEvolutionDigest,
} from './evolution-observer';

export type EvolutionDagRoute = 'evolution' | 'repair' | 'replay' | 'no_op';
export type EvolutionCandidateType = 'skill' | 'role';

export interface EvolutionReplayCase {
  id: string;
  intent: string;
  expected_outcome: string;
  source_trace_refs: string[];
}

export interface EvolutionInspectorDecision {
  version: 1;
  route: EvolutionDagRoute;
  summary: string;
  finding_refs: string[];
  evidence_refs: string[];
  reason?: string;
  replay_case?: EvolutionReplayCase;
}

export interface EvolutionCandidateDecision {
  version: 1;
  status: 'candidate' | 'blocked';
  summary: string;
  evidence_refs: string[];
  candidate?: {
    type: EvolutionCandidateType;
    name: string;
    path: string;
  };
  reason?: string;
}

export interface EvolutionEngineerDecision {
  version: 1;
  status: 'fixed' | 'next_run' | 'blocked';
  summary: string;
  artifact_refs: string[];
  verification_refs: string[];
  reason?: string;
}

export interface EvolutionReviewerDecision {
  version: 1;
  status: 'closed' | 'next_run' | 'blocked';
  summary: string;
  evidence_refs: string[];
  reason?: string;
}

export interface EvolutionRoleStageInput {
  stage: 'inspector' | 'evolution' | 'engineer' | 'reviewer';
  roleName: 'inspector-cat' | 'evolution-cat' | 'engineer-cat' | 'reviewer-cat';
  skillName?: string;
  task: string;
  workingDirectory: string;
  parentSessionId: string;
  hiddenTools?: string[];
  allowedWriteRoot?: string;
}

export interface EvolutionArenaInput {
  workingDirectory: string;
  targetDate: string;
  candidate: {
    type: EvolutionCandidateType;
    name: string;
    path: string;
  };
  finding: EvolutionInspectorDecision;
}

export interface EvolutionArenaResult {
  run_id: string;
  decision: 'pass' | 'unstable' | 'reopened' | 'blocked' | 'unsafe';
  scorecard_ref: string;
  subject_id: string;
  subject_manifest_ref: string;
  subject_fingerprint: string;
}

export interface EvolutionDagDependencies {
  buildDigest?: (options: {
    workingDirectory: string;
    targetDate: string;
    minOccurrences: number;
  }) => BuildEvolutionDigestResult;
  runRoleStage?: (input: EvolutionRoleStageInput) => Promise<string>;
  runArena?: (input: EvolutionArenaInput) => Promise<EvolutionArenaResult>;
  now?: () => Date;
}

export interface EvolutionDagOptions {
  workingDirectory: string;
  targetDate: string;
  minOccurrences: number;
  verbose?: boolean;
}

export interface EvolutionDagStageRecord {
  name: 'harvest' | 'inspector' | 'evolution' | 'engineer' | 'reviewer' | 'arena';
  role?: EvolutionRoleStageInput['roleName'];
  status: 'running' | 'completed' | 'blocked';
  input_ref?: string;
  output_ref?: string;
  summary?: string;
}

export interface EvolutionDagManifest {
  version: 1;
  run_id: string;
  target_date: string;
  status: 'running' | 'completed' | 'blocked';
  route?: EvolutionDagRoute;
  digest_ref?: string;
  inspector_ref?: string;
  next_run_seed_input_ref?: string;
  stages: EvolutionDagStageRecord[];
  terminal?: {
    status: 'no_op' | 'arena_complete' | 'closed' | 'next_run' | 'blocked';
    summary: string;
    evidence_refs?: string[];
    candidate_ref?: string;
    arena_run_ref?: string;
    arena_decision?: EvolutionArenaResult['decision'];
    promotion_recommendation?: 'promote' | 'reject';
    promotion_ref?: string;
    next_run_seed_ref?: string;
  };
  started_at: string;
  completed_at?: string;
  manifest_ref: string;
}

interface PendingNextRunSeed {
  ref: string;
  path: string;
  value: {
    version: 1;
    source: 'engineer-cat' | 'reviewer-cat';
    summary: string;
    evidence_refs: string[];
    replay_case?: EvolutionReplayCase;
    created_at: string;
  };
}

const INSPECTOR_HIDDEN_TOOLS = ['write_file', 'edit_file', 'execute_shell', 'ask_parent'];
const EVOLUTION_HIDDEN_TOOLS = ['edit_file', 'execute_shell', 'remember', 'ask_parent'];
const ENGINEER_HIDDEN_TOOLS = ['ask_parent'];
const REVIEWER_HIDDEN_TOOLS = [
  'write_file',
  'edit_file',
  'execute_shell',
  'ask_parent',
  'codex_job_start',
  'codex_job_resume',
  'codex_job_cancel',
  'engineer_task_run',
  'engineer_task_resume',
  'engineer_task_cancel',
  'reviewer_xiaoba_cli_e2e',
  'reviewer_module_test',
  'reviewer_eval_prepare',
];
const REVIEWER_REPLAY_EVIDENCE_FILES = new Set([
  'manifest.json',
  'replay-results.json',
  'comparison.json',
  'report.md',
]);
const ARENA_DECISIONS = new Set(['pass', 'unstable', 'reopened', 'blocked', 'unsafe']);
const ARENA_DEFINITIVE_REJECTIONS = new Set(['unstable', 'reopened', 'unsafe']);

export async function runEvolutionDag(
  options: EvolutionDagOptions,
  dependencies: EvolutionDagDependencies = {},
): Promise<EvolutionDagManifest> {
  const root = path.resolve(options.workingDirectory);
  const runRoot = path.join(root, 'output', 'evolution', 'sleep', options.targetDate);
  const manifestPath = path.join(runRoot, 'dag-run.json');
  const now = dependencies.now || (() => new Date());
  const buildDigest = dependencies.buildDigest || buildEvolutionDigest;
  const runRoleStage = dependencies.runRoleStage || runDefaultEvolutionRoleStage;
  const runArena = dependencies.runArena || runDefaultEvolutionArena;
  const sleepRoot = path.dirname(runRoot);
  const promotedSameDateRun = readPromotedSameDateRun(root, runRoot, manifestPath);
  if (promotedSameDateRun) {
    return promotedSameDateRun;
  }
  const unresolvedSameDateRun = readUnresolvedSameDateRun(root, runRoot, manifestPath);
  if (unresolvedSameDateRun) {
    return unresolvedSameDateRun;
  }
  fs.mkdirSync(sleepRoot, { recursive: true });
  assertRealPathInside(root, sleepRoot, 'Evolution sleep root');
  resetOwnedDirectory(sleepRoot, runRoot, 'Evolution run root');

  const manifest: EvolutionDagManifest = {
    version: 1,
    run_id: `evolution-dag-${options.targetDate}`,
    target_date: options.targetDate,
    status: 'running',
    stages: [],
    started_at: now().toISOString(),
    manifest_ref: displayPath(manifestPath, root),
  };
  writeManifest(manifestPath, manifest);

  try {
    const harvestStage = beginStage(manifest, manifestPath, { name: 'harvest' });
    const digestResult = buildDigest({
      workingDirectory: root,
      targetDate: options.targetDate,
      minOccurrences: options.minOccurrences,
    });
    manifest.digest_ref = displayPath(digestResult.digestPath, root);
    completeStage(harvestStage, manifest, manifestPath, {
      output_ref: manifest.digest_ref,
      summary: `${digestResult.digest.totals.observations} observations from ${digestResult.digest.totals.sessions} sessions`,
    });

    const pendingSeed = findPendingNextRunSeed(root, options.targetDate);
    if (pendingSeed) {
      manifest.next_run_seed_input_ref = pendingSeed.ref;
      writeManifest(manifestPath, manifest);
    }

    const inspectorStage = beginStage(manifest, manifestPath, {
      name: 'inspector',
      role: 'inspector-cat',
      input_ref: manifest.digest_ref,
    });
    const inspectorRaw = await runRoleStage({
      stage: 'inspector',
      roleName: 'inspector-cat',
      task: buildInspectorDagPrompt(manifest.digest_ref, options.targetDate, pendingSeed?.ref),
      workingDirectory: root,
      parentSessionId: `evolution:dag:${options.targetDate}`,
      hiddenTools: INSPECTOR_HIDDEN_TOOLS,
    });
    const inspectorRawPath = path.join(runRoot, 'inspector-output.txt');
    fs.writeFileSync(inspectorRawPath, inspectorRaw, 'utf-8');
    const inspectorDecision = parseInspectorDecision(inspectorRaw);
    validateInspectorEvidence(root, inspectorDecision, digestResult.digest, pendingSeed);
    const inspectorPath = path.join(runRoot, 'inspector-route.json');
    atomicWriteJson(inspectorPath, inspectorDecision);
    manifest.route = inspectorDecision.route;
    manifest.inspector_ref = displayPath(inspectorPath, root);
    completeStage(inspectorStage, manifest, manifestPath, {
      output_ref: manifest.inspector_ref,
      summary: inspectorDecision.summary,
    });
    let result: EvolutionDagManifest;
    switch (inspectorDecision.route) {
      case 'no_op':
        result = finishManifest(manifest, manifestPath, now, {
          status: 'no_op',
          summary: inspectorDecision.reason || inspectorDecision.summary,
          evidence_refs: inspectorDecision.evidence_refs,
        });
        break;
      case 'evolution':
        result = await runEvolutionBranch({
          root,
          runRoot,
          manifest,
          manifestPath,
          inspectorDecision,
          targetDate: options.targetDate,
          runRoleStage,
          runArena,
          now,
        });
        break;
      case 'repair':
        result = await runRepairBranch({
          root,
          runRoot,
          manifest,
          manifestPath,
          inspectorDecision,
          targetDate: options.targetDate,
          runRoleStage,
          now,
        });
        break;
      case 'replay':
        result = await runReviewerBranch({
          root,
          runRoot,
          manifest,
          manifestPath,
          inspectorDecision,
          targetDate: options.targetDate,
          runRoleStage,
          now,
        });
        break;
    }
    if (
      pendingSeed
      && (result.terminal?.status === 'closed' || result.terminal?.status === 'next_run')
    ) {
      markNextRunSeedConsumed(pendingSeed, result.manifest_ref, now().toISOString());
    }
    return result;
  } catch (error: any) {
    const runningStage = [...manifest.stages].reverse().find(stage => stage.status === 'running');
    if (runningStage) {
      runningStage.status = 'blocked';
      runningStage.summary = errorMessage(error);
    }
    return finishManifest(manifest, manifestPath, now, {
      status: 'blocked',
      summary: errorMessage(error),
    }, 'blocked');
  }
}

async function runEvolutionBranch(input: {
  root: string;
  runRoot: string;
  manifest: EvolutionDagManifest;
  manifestPath: string;
  inspectorDecision: EvolutionInspectorDecision;
  targetDate: string;
  runRoleStage: NonNullable<EvolutionDagDependencies['runRoleStage']>;
  runArena: NonNullable<EvolutionDagDependencies['runArena']>;
  now: () => Date;
}): Promise<EvolutionDagManifest> {
  const candidateRoot = path.join(input.runRoot, 'candidates');
  resetOwnedDirectory(input.runRoot, candidateRoot, 'Evolution candidates root');
  const stage = beginStage(input.manifest, input.manifestPath, {
    name: 'evolution',
    role: 'evolution-cat',
    input_ref: input.manifest.inspector_ref,
  });
  const raw = await input.runRoleStage({
    stage: 'evolution',
    roleName: 'evolution-cat',
    skillName: 'self-evolution',
    task: buildEvolutionDagPrompt('inspector-route.json', 'digest.json', input.targetDate),
    workingDirectory: input.runRoot,
    parentSessionId: `evolution:dag:${input.targetDate}`,
    hiddenTools: EVOLUTION_HIDDEN_TOOLS,
    allowedWriteRoot: candidateRoot,
  });
  fs.writeFileSync(path.join(input.runRoot, 'evolution-output.txt'), raw, 'utf-8');
  const decision = parseEvolutionDecision(raw);
  validateEvolutionEvidence(decision, input.inspectorDecision);
  const decisionPath = path.join(input.runRoot, 'evolution-candidate.json');
  atomicWriteJson(decisionPath, decision);
  validateCandidateOutputLayout(decision, candidateRoot, input.runRoot);
  const candidate = decision.status === 'candidate' && decision.candidate
    ? validateCandidate(decision.candidate, candidateRoot, input.runRoot)
    : undefined;
  completeStage(stage, input.manifest, input.manifestPath, {
    output_ref: displayPath(decisionPath, input.root),
    summary: decision.summary,
  });

  if (decision.status !== 'candidate' || !candidate) {
    return finishManifest(input.manifest, input.manifestPath, input.now, {
      status: 'blocked',
      summary: decision.reason || decision.summary,
      evidence_refs: decision.evidence_refs,
    }, 'blocked');
  }

  const arenaStage = beginStage(input.manifest, input.manifestPath, {
    name: 'arena',
    input_ref: displayPath(candidate.path, input.root),
  });
  const arena = await input.runArena({
    workingDirectory: input.root,
    targetDate: input.targetDate,
    candidate,
    finding: input.inspectorDecision,
  });
  validateLocalEvidenceRefs(input.root, [arena.scorecard_ref], 'Arena scorecard');
  if (ARENA_DEFINITIVE_REJECTIONS.has(arena.decision)) {
    markCandidateBlocked(candidate);
  }
  const arenaResultPath = path.join(input.runRoot, 'arena-result.json');
  atomicWriteJson(arenaResultPath, arena);
  completeStage(arenaStage, input.manifest, input.manifestPath, {
    output_ref: displayPath(arenaResultPath, input.root),
    summary: `${arena.decision}: ${arena.scorecard_ref}`,
  });

  return finishManifest(input.manifest, input.manifestPath, input.now, {
    status: 'arena_complete',
    summary: `${candidate.type} candidate ${candidate.name} completed Arena with decision ${arena.decision}`,
    evidence_refs: decision.evidence_refs,
    candidate_ref: displayPath(candidate.path, input.root),
    arena_run_ref: arena.scorecard_ref,
    arena_decision: arena.decision,
    ...(arena.decision === 'pass'
      ? { promotion_recommendation: 'promote' as const }
      : ARENA_DEFINITIVE_REJECTIONS.has(arena.decision)
        ? { promotion_recommendation: 'reject' as const }
        : {}),
  });
}

async function runRepairBranch(input: {
  root: string;
  runRoot: string;
  manifest: EvolutionDagManifest;
  manifestPath: string;
  inspectorDecision: EvolutionInspectorDecision;
  targetDate: string;
  runRoleStage: NonNullable<EvolutionDagDependencies['runRoleStage']>;
  now: () => Date;
}): Promise<EvolutionDagManifest> {
  const engineerStage = beginStage(input.manifest, input.manifestPath, {
    name: 'engineer',
    role: 'engineer-cat',
    input_ref: input.manifest.inspector_ref,
  });
  const raw = await input.runRoleStage({
    stage: 'engineer',
    roleName: 'engineer-cat',
    skillName: 'case-implementation',
    task: buildEngineerDagPrompt(input.manifest.inspector_ref || '', input.targetDate),
    workingDirectory: input.root,
    parentSessionId: `evolution:dag:${input.targetDate}`,
    hiddenTools: ENGINEER_HIDDEN_TOOLS,
  });
  fs.writeFileSync(path.join(input.runRoot, 'engineer-output.txt'), raw, 'utf-8');
  const decision = parseEngineerDecision(raw);
  if (decision.status === 'fixed' || decision.status === 'next_run') {
    validateLocalEvidenceRefs(
      input.root,
      uniqueStrings([...decision.artifact_refs, ...decision.verification_refs]),
      `Engineer ${decision.status}`,
    );
  }
  const decisionPath = path.join(input.runRoot, 'engineer-result.json');
  atomicWriteJson(decisionPath, decision);
  completeStage(engineerStage, input.manifest, input.manifestPath, {
    output_ref: displayPath(decisionPath, input.root),
    summary: decision.summary,
  });

  if (decision.status !== 'fixed') {
    if (decision.status === 'next_run') {
      return finishWithNextRunSeed({
        root: input.root,
        runRoot: input.runRoot,
        manifest: input.manifest,
        manifestPath: input.manifestPath,
        now: input.now,
        source: 'engineer-cat',
        summary: decision.summary,
        evidenceRefs: uniqueStrings([...decision.artifact_refs, ...decision.verification_refs]),
        replayCase: input.inspectorDecision.replay_case,
      });
    }
    return finishManifest(input.manifest, input.manifestPath, input.now, {
      status: 'blocked',
      summary: decision.reason || decision.summary,
      evidence_refs: uniqueStrings([...decision.artifact_refs, ...decision.verification_refs]),
    }, 'blocked');
  }

  return runReviewerBranch({
    ...input,
    engineerDecision: decision,
    engineerResultRef: displayPath(decisionPath, input.root),
  });
}

async function runReviewerBranch(input: {
  root: string;
  runRoot: string;
  manifest: EvolutionDagManifest;
  manifestPath: string;
  inspectorDecision: EvolutionInspectorDecision;
  targetDate: string;
  runRoleStage: NonNullable<EvolutionDagDependencies['runRoleStage']>;
  now: () => Date;
  engineerDecision?: EvolutionEngineerDecision;
  engineerResultRef?: string;
}): Promise<EvolutionDagManifest> {
  resetOwnedDirectory(
    input.runRoot,
    path.join(input.runRoot, 'reviewer-replay'),
    'Reviewer replay output',
  );
  const stage = beginStage(input.manifest, input.manifestPath, {
    name: 'reviewer',
    role: 'reviewer-cat',
    input_ref: input.engineerResultRef || input.manifest.inspector_ref,
  });
  const raw = await input.runRoleStage({
    stage: 'reviewer',
    roleName: 'reviewer-cat',
    skillName: 'case-review',
    task: buildReviewerDagPrompt(
      input.manifest.inspector_ref || '',
      input.targetDate,
      input.engineerResultRef,
    ),
    workingDirectory: input.root,
    parentSessionId: `evolution:dag:${input.targetDate}`,
    hiddenTools: REVIEWER_HIDDEN_TOOLS,
  });
  fs.writeFileSync(path.join(input.runRoot, 'reviewer-output.txt'), raw, 'utf-8');
  const decision = parseReviewerDecision(raw);
  if (decision.status === 'closed' || decision.status === 'next_run') {
    validateReviewerEvidenceRefs(
      input.root,
      input.runRoot,
      decision.evidence_refs,
      `Reviewer ${decision.status}`,
    );
  }
  const decisionPath = path.join(input.runRoot, 'reviewer-result.json');
  atomicWriteJson(decisionPath, decision);
  completeStage(stage, input.manifest, input.manifestPath, {
    output_ref: displayPath(decisionPath, input.root),
    summary: decision.summary,
  });

  if (decision.status === 'next_run') {
    return finishWithNextRunSeed({
      root: input.root,
      runRoot: input.runRoot,
      manifest: input.manifest,
      manifestPath: input.manifestPath,
      now: input.now,
      source: 'reviewer-cat',
      summary: decision.summary,
      evidenceRefs: decision.evidence_refs,
      replayCase: input.inspectorDecision.replay_case,
    });
  }

  return finishManifest(input.manifest, input.manifestPath, input.now, {
    status: decision.status,
    summary: decision.reason || decision.summary,
    evidence_refs: decision.evidence_refs,
  }, decision.status === 'blocked' ? 'blocked' : 'completed');
}

function finishWithNextRunSeed(input: {
  root: string;
  runRoot: string;
  manifest: EvolutionDagManifest;
  manifestPath: string;
  now: () => Date;
  source: 'engineer-cat' | 'reviewer-cat';
  summary: string;
  evidenceRefs: string[];
  replayCase?: EvolutionReplayCase;
}): EvolutionDagManifest {
  const seedPath = path.join(input.runRoot, 'next-run-seed.json');
  atomicWriteJson(seedPath, {
    version: 1,
    source: input.source,
    summary: input.summary,
    evidence_refs: input.evidenceRefs,
    ...(input.replayCase && { replay_case: input.replayCase }),
    created_at: input.now().toISOString(),
  });
  return finishManifest(input.manifest, input.manifestPath, input.now, {
    status: 'next_run',
    summary: input.summary,
    evidence_refs: input.evidenceRefs,
    next_run_seed_ref: displayPath(seedPath, input.root),
  });
}

export async function runDefaultEvolutionRoleStage(input: EvolutionRoleStageInput): Promise<string> {
  const skills = new SkillManager(input.roleName);
  await skills.loadSkills();
  const session = new SubAgentSession(
    `evolution-${input.stage}-${crypto.randomUUID()}`,
    new AIService(),
    skills,
    {
      roleName: input.roleName,
      skillName: input.skillName,
      taskDescription: `evolution DAG ${input.stage}`,
      userMessage: input.task,
      workingDirectory: input.workingDirectory,
      parentSessionId: input.parentSessionId,
      allowSkillSelection: false,
      hiddenTools: input.hiddenTools,
      allowedWriteRoot: input.allowedWriteRoot,
    },
  );
  await session.run();
  const info = session.getInfo();
  if (info.status !== 'completed' || !info.resultSummary?.trim()) {
    throw new Error(`${input.roleName} stage ${input.stage} failed: ${info.resultSummary || info.status}`);
  }
  return info.resultSummary;
}

export async function runDefaultEvolutionArena(input: EvolutionArenaInput): Promise<EvolutionArenaResult> {
  const manager = new ArenaManager({ projectRoot: input.workingDirectory });
  const subject = input.candidate.type === 'skill'
    ? manager.importLocalSkill({
      skillPath: input.candidate.path,
      trustLevel: 'review_required',
      allowedRuntime: 'arena_only',
    })
    : manager.importLocalRole({
      rolePath: input.candidate.path,
      trustLevel: 'review_required',
      allowedRuntime: 'arena_only',
    });
  const result = await executeArenaRun({
    projectRoot: input.workingDirectory,
    reviewMode: input.candidate.type === 'skill' ? 'base_skill' : 'role',
    subjectId: subject.subject_id,
    ...(input.candidate.type === 'role' ? { targetRoleId: input.candidate.name } : {}),
    runId: `evolution-${input.targetDate}-${safeSegment(input.candidate.name)}`,
    // Inspector owns diagnosis; Arena's default openings exercise the subject as a user would.
    scenarioCount: 3,
    replayAttempts: 3,
  });
  const decision = String(result.scorecard?.decision || '');
  if (!ARENA_DECISIONS.has(decision)) {
    throw new Error(`Arena completed without a valid decision: ${decision || 'missing'}`);
  }
  if (!result.scorecard_path) {
    throw new Error('Arena completed without scorecard_path');
  }
  return {
    run_id: result.run_id,
    decision: decision as EvolutionArenaResult['decision'],
    scorecard_ref: displayPath(result.scorecard_path, input.workingDirectory),
    subject_id: subject.subject_id,
    subject_manifest_ref: displayPath(
      path.join(manager.getSubjectsRoot(), subject.subject_id, 'arena-manifest.json'),
      input.workingDirectory,
    ),
    subject_fingerprint: subject.fingerprint,
  };
}

export function buildInspectorDagPrompt(
  digestRef: string,
  targetDate: string,
  pendingSeedRef?: string,
): string {
  return [
    '[evolution_sleep][evolution_dag:inspector]',
    `Target date: ${targetDate}`,
    `Digest: ${digestRef}`,
    `Previous unresolved handoff: ${pendingSeedRef || 'none'}`,
    '',
    'You are the first model stage. Read the deterministic digest and, when needed, its source trace refs.',
    'Diagnose; do not fix, generate a capability, run acceptance, or dispatch another role.',
    'Return exactly one JSON object and no prose:',
    '{"version":1,"route":"evolution|repair|replay|no_op","summary":"...","finding_refs":["pattern/finding ref"],"evidence_refs":["source trace ref"],"reason":"optional","replay_case":{"id":"...","intent":"...","expected_outcome":"...","source_trace_refs":["..."]}}',
    'Use only digest-owned refs: finding_refs must be pattern:<pattern_id>, observation:<observation_id>, or handoff:<seed-ref>; evidence_refs and replay source refs must be copied exactly from the digest or pending handoff.',
    'Route boundary: evolution means a repeated task-level working method, output protocol, or reusable behavior gap that a Candidate Skill/Role can solve without changing runtime code. Repeated user corrections about how work should be performed or formatted belong here.',
    'Route boundary: repair means a concrete Runtime, Tool, Session, permission, trace-collection, or repository-code defect that requires an engineering change. Do not choose repair merely because a prompt could be edited when a reusable Candidate capability is sufficient.',
    'Route boundary: replay means one frozen case needs independent reproduction or verification and no new capability or engineering change is yet justified. no_op means the evidence does not support any of the three actions.',
    'Rules: evolution requires source trace refs from at least two independent task lineages; repair/replay require replay_case; no_op requires an explicit reason. Never invent a ref or route by confidence alone.',
    'When a previous unresolved handoff is present, it is the mandatory subject of this run: include handoff:<seed-ref> in finding_refs, include the seed ref in evidence_refs, preserve its Replay Case exactly, and route only to repair or replay.',
  ].join('\n');
}

export function buildEvolutionDagPrompt(inspectorRef: string, digestRef: string, targetDate: string): string {
  return [
    '[evolution_sleep][evolution_dag:evolution]',
    `Target date: ${targetDate}`,
    `Inspector decision: ${inspectorRef}`,
    `Digest: ${digestRef}`,
    '',
    'Activate the preselected self-evolution workflow. Consume Inspector findings; do not harvest or diagnose again.',
    'At most one reusable Candidate Skill or Candidate Role may be created under candidates/<name>/. Never write outside this working directory.',
    'A Skill candidate must contain candidates/<name>/SKILL.md with status: candidate.',
    'If a Skill promises fixed line-by-line output, it must declare arena-output-line-prefixes explicitly and make its description trigger on the initial request, any mention or meta-question about the named protocol, and every relevant follow-up. Its body must say that once active, every evaluated turn (execute, explain, test, inspect, redo, follow-up, or missing-input wording) makes its first and only text delivery exactly one successful send_text containing only those non-empty lines, with no preliminary explanation, split delivery, delegation, or extra assistant text. If the finding is only about formatting supplied input, keep the Candidate a pure formatter: use no other tools, run no task, create no file, and express missing evidence inside the declared lines. Never guess a deterministic contract from prose.',
    'A Role candidate must contain candidates/<name>/role.json and its prompt, with status: candidate.',
    'Do not run Arena, publish, promote, repair runtime code, or write memory.',
    'Return exactly one JSON object and no prose:',
    '{"version":1,"status":"candidate|blocked","summary":"...","evidence_refs":["at least two trace refs"],"candidate":{"type":"skill|role","name":"...","path":"candidates/..."},"reason":"required when blocked"}',
    'Inspector already owns the route decision. Do not return no_op or reinterpret the finding; if you cannot safely produce the candidate, return blocked with a reason.',
  ].join('\n');
}

export function buildEngineerDagPrompt(inspectorRef: string, targetDate: string): string {
  return [
    '[evolution_sleep][evolution_dag:engineer]',
    `Target date: ${targetDate}`,
    `Inspector replay case and evidence: ${inspectorRef}`,
    '',
    'Implement only the diagnosed engineering repair and verify it. Do not close the case yourself.',
    'If the underlying engineering job is still running when this bounded stage must end, return next_run with stable artifact/task refs; do not pretend it is fixed.',
    'Every artifact_ref and verification_ref for fixed/next_run must resolve to an existing local file or directory.',
    'Return exactly one JSON object and no prose:',
    '{"version":1,"status":"fixed|next_run|blocked","summary":"...","artifact_refs":["..."],"verification_refs":["..."],"reason":"optional"}',
  ].join('\n');
}

export function buildReviewerDagPrompt(
  inspectorRef: string,
  targetDate: string,
  engineerResultRef?: string,
): string {
  return [
    '[evolution_sleep][evolution_dag:reviewer]',
    `Target date: ${targetDate}`,
    `Inspector-authored replay case: ${inspectorRef}`,
    ...(engineerResultRef ? [`Engineer result: ${engineerResultRef}`] : []),
    '',
    'Run the replay case in a clean session and make the independent closure decision.',
    'Call reviewer_trace_replay exactly once with {}. It derives the frozen case from this trusted DAG parent; never pass a path, cwd, command, message, or verifier.',
    'You must not edit code, start/resume coding jobs, or ask EngineerCat to repair inside this run.',
    'A failure becomes next_run, not a same-run back-edge.',
    `Every evidence_ref for closed/next_run must resolve under output/evolution/sleep/${targetDate}/reviewer-replay/. If deterministic replay is blocked, return blocked rather than claiming closure.`,
    'Return exactly one JSON object and no prose:',
    '{"version":1,"status":"closed|next_run|blocked","summary":"...","evidence_refs":["fresh replay/verification ref"],"reason":"optional"}',
  ].join('\n');
}

export function parseInspectorDecision(raw: string): EvolutionInspectorDecision {
  const value = parseJsonObject(raw, 'Inspector');
  requireVersion1(value, 'Inspector');
  const route = readEnum(value.route, ['evolution', 'repair', 'replay', 'no_op'], 'Inspector.route');
  const decision: EvolutionInspectorDecision = {
    version: 1,
    route,
    summary: readRequiredString(value.summary, 'Inspector.summary'),
    finding_refs: readStringArray(value.finding_refs),
    evidence_refs: uniqueStrings(readStringArray(value.evidence_refs)),
    ...(readOptionalString(value.reason) ? { reason: readOptionalString(value.reason) } : {}),
  };
  if (route === 'no_op') {
    if (!decision.reason) throw new Error('Inspector no_op requires reason');
    return decision;
  }
  if (decision.finding_refs.length === 0 || decision.evidence_refs.length === 0) {
    throw new Error(`Inspector ${route} requires finding_refs and evidence_refs`);
  }
  if (route === 'evolution' && decision.evidence_refs.length < 2) {
    throw new Error('Inspector evolution requires at least two distinct evidence_refs');
  }
  if (route === 'repair' || route === 'replay') {
    decision.replay_case = parseReplayCase(value.replay_case);
  }
  return decision;
}

export function parseEvolutionDecision(raw: string): EvolutionCandidateDecision {
  const value = parseJsonObject(raw, 'Evolution');
  requireVersion1(value, 'Evolution');
  const status = readEnum(value.status, ['candidate', 'blocked'], 'Evolution.status');
  const decision: EvolutionCandidateDecision = {
    version: 1,
    status,
    summary: readRequiredString(value.summary, 'Evolution.summary'),
    evidence_refs: uniqueStrings(readStringArray(value.evidence_refs)),
    ...(readOptionalString(value.reason) ? { reason: readOptionalString(value.reason) } : {}),
  };
  if (decision.evidence_refs.length < 2) {
    throw new Error(`Evolution ${status} requires at least two distinct evidence_refs`);
  }
  if (status === 'candidate') {
    const candidate = asObject(value.candidate, 'Evolution.candidate');
    decision.candidate = {
      type: readEnum(candidate.type, ['skill', 'role'], 'Evolution.candidate.type'),
      name: readSafeName(candidate.name, 'Evolution.candidate.name'),
      path: readRequiredString(candidate.path, 'Evolution.candidate.path'),
    };
  } else if (!decision.reason) {
    throw new Error(`Evolution ${status} requires reason`);
  }
  return decision;
}

function markCandidateBlocked(candidate: EvolutionArenaInput['candidate']): void {
  if (candidate.type === 'skill') {
    SkillParser.updateStatus(candidate.path, 'blocked');
    return;
  }
  const roleFile = path.join(candidate.path, 'role.json');
  const role = JSON.parse(fs.readFileSync(roleFile, 'utf-8')) as Record<string, unknown>;
  atomicWriteJson(roleFile, { ...role, status: 'blocked' });
}

export function parseEngineerDecision(raw: string): EvolutionEngineerDecision {
  const value = parseJsonObject(raw, 'Engineer');
  requireVersion1(value, 'Engineer');
  const status = readEnum(value.status, ['fixed', 'next_run', 'blocked'], 'Engineer.status');
  const decision: EvolutionEngineerDecision = {
    version: 1,
    status,
    summary: readRequiredString(value.summary, 'Engineer.summary'),
    artifact_refs: uniqueStrings(readStringArray(value.artifact_refs)),
    verification_refs: uniqueStrings(readStringArray(value.verification_refs)),
    ...(readOptionalString(value.reason) ? { reason: readOptionalString(value.reason) } : {}),
  };
  if ((status === 'fixed' || status === 'next_run')
    && decision.artifact_refs.length + decision.verification_refs.length === 0) {
    throw new Error(`Engineer ${status} requires artifact_refs or verification_refs`);
  }
  if (status === 'blocked' && !decision.reason) {
    throw new Error('Engineer blocked requires reason');
  }
  return decision;
}

export function parseReviewerDecision(raw: string): EvolutionReviewerDecision {
  const value = parseJsonObject(raw, 'Reviewer');
  requireVersion1(value, 'Reviewer');
  const status = readEnum(value.status, ['closed', 'next_run', 'blocked'], 'Reviewer.status');
  const decision: EvolutionReviewerDecision = {
    version: 1,
    status,
    summary: readRequiredString(value.summary, 'Reviewer.summary'),
    evidence_refs: uniqueStrings(readStringArray(value.evidence_refs)),
    ...(readOptionalString(value.reason) ? { reason: readOptionalString(value.reason) } : {}),
  };
  if ((status === 'closed' || status === 'next_run') && decision.evidence_refs.length === 0) {
    throw new Error(`Reviewer ${status} requires fresh evidence_refs`);
  }
  if (status === 'blocked' && !decision.reason) {
    throw new Error('Reviewer blocked requires reason');
  }
  return decision;
}

function validateCandidate(
  candidate: NonNullable<EvolutionCandidateDecision['candidate']>,
  candidateRoot: string,
  stageRoot: string,
): EvolutionArenaInput['candidate'] {
  const requested = path.resolve(stageRoot, candidate.path);
  const relative = path.relative(candidateRoot, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Evolution candidate escaped candidates root: ${candidate.path}`);
  }
  if (!fs.existsSync(requested)) {
    throw new Error(`Evolution candidate path does not exist: ${candidate.path}`);
  }
  assertRealPathInside(candidateRoot, requested, 'Evolution candidate');

  if (candidate.type === 'skill') {
    const skillFile = fs.statSync(requested).isDirectory() ? path.join(requested, 'SKILL.md') : requested;
    if (path.basename(skillFile) !== 'SKILL.md' || !fs.existsSync(skillFile)) {
      throw new Error('Skill candidate must point to a SKILL.md file or its directory');
    }
    const skill = SkillParser.parse(skillFile);
    if (skill.metadata.name !== candidate.name) {
      throw new Error(`Skill candidate name mismatch: ${candidate.name} != ${skill.metadata.name}`);
    }
    if ((skill.metadata as { status?: string }).status !== 'candidate') {
      throw new Error('Skill candidate must declare status: candidate');
    }
    return { ...candidate, path: skillFile };
  }

  const roleFile = fs.statSync(requested).isDirectory() ? path.join(requested, 'role.json') : requested;
  if (path.basename(roleFile) !== 'role.json' || !fs.existsSync(roleFile)) {
    throw new Error('Role candidate must point to role.json or its directory');
  }
  const role = JSON.parse(fs.readFileSync(roleFile, 'utf-8')) as Record<string, unknown>;
  if (role.name !== candidate.name) {
    throw new Error(`Role candidate name mismatch: ${candidate.name} != ${String(role.name || '')}`);
  }
  if (role.status !== 'candidate') {
    throw new Error('Role candidate must declare status: candidate');
  }
  const roleRoot = path.dirname(roleFile);
  const promptFile = typeof role.promptFile === 'string' ? role.promptFile.trim() : '';
  if (!promptFile || path.isAbsolute(promptFile) || promptFile.includes('/') || promptFile.includes('\\') || promptFile.includes('..')) {
    throw new Error('Role candidate must declare a safe promptFile name');
  }
  const promptPath = path.join(roleRoot, 'prompts', promptFile);
  if (!fs.existsSync(promptPath) || fs.lstatSync(promptPath).isSymbolicLink() || !fs.statSync(promptPath).isFile()) {
    throw new Error(`Role candidate prompt does not exist as a regular file: prompts/${promptFile}`);
  }
  assertRealPathInside(roleRoot, promptPath, 'Role candidate prompt');
  return { ...candidate, path: roleRoot };
}

function validateCandidateOutputLayout(
  decision: EvolutionCandidateDecision,
  candidateRoot: string,
  stageRoot: string,
): void {
  const entries = fs.readdirSync(candidateRoot, { withFileTypes: true });
  if (decision.status !== 'candidate' || !decision.candidate) {
    if (entries.length > 0) {
      throw new Error(`Evolution ${decision.status} must not leave candidate output`);
    }
    return;
  }

  const candidate = decision.candidate;
  if (
    entries.length !== 1
    || entries[0].name !== candidate.name
    || !entries[0].isDirectory()
    || entries[0].isSymbolicLink()
  ) {
    throw new Error(`Evolution must create exactly one candidate package: candidates/${candidate.name}/`);
  }

  const expectedPackageRoot = path.resolve(candidateRoot, candidate.name);
  const declaredPath = path.resolve(stageRoot, candidate.path);
  if (!isInsideRoot(expectedPackageRoot, declaredPath)) {
    throw new Error(`Evolution candidate path must stay inside candidates/${candidate.name}/`);
  }
}

function validateInspectorEvidence(
  root: string,
  decision: EvolutionInspectorDecision,
  digest: EvolutionDigest,
  pendingSeed?: PendingNextRunSeed,
): void {
  if (pendingSeed && decision.route !== 'repair' && decision.route !== 'replay') {
    throw new Error('An unresolved next_run handoff must route to repair or replay');
  }
  if (pendingSeed) {
    const handoffFinding = `handoff:${pendingSeed.ref}`;
    if (!decision.finding_refs.includes(handoffFinding) || !decision.evidence_refs.includes(pendingSeed.ref)) {
      throw new Error('Inspector must bind the run to the unresolved next_run handoff');
    }
    if (
      !pendingSeed.value.replay_case
      || !decision.replay_case
      || JSON.stringify(decision.replay_case) !== JSON.stringify(pendingSeed.value.replay_case)
    ) {
      throw new Error('Inspector must preserve the unresolved next_run Replay Case exactly');
    }
  }
  const traceRefs = new Set(digest.observations.map(observation => observation.trace_ref));
  const findingRefs = new Set([
    ...digest.patterns.map(pattern => `pattern:${pattern.pattern_id}`),
    ...digest.observations.map(observation => `observation:${observation.observation_id}`),
    ...(pendingSeed ? [`handoff:${pendingSeed.ref}`] : []),
  ]);
  const evidenceByFinding = new Map<string, string[]>([
    ...digest.patterns.map(pattern => [
      `pattern:${pattern.pattern_id}`,
      pattern.sample_trace_refs,
    ] as [string, string[]]),
    ...digest.observations.map(observation => [
      `observation:${observation.observation_id}`,
      [observation.trace_ref],
    ] as [string, string[]]),
    ...(pendingSeed ? [[
      `handoff:${pendingSeed.ref}`,
      [
        pendingSeed.ref,
        ...pendingSeed.value.evidence_refs,
        ...(pendingSeed.value.replay_case?.source_trace_refs || []),
      ],
    ] as [string, string[]]] : []),
  ]);
  const findingEvidenceRefs = new Set(
    decision.finding_refs.flatMap(ref => evidenceByFinding.get(ref) || []),
  );

  assertRefsOwnedBy(decision.finding_refs, findingRefs, 'Inspector finding_refs');
  assertRefsOwnedBy(decision.evidence_refs, findingEvidenceRefs, 'Inspector evidence_refs for selected findings');
  if (decision.route !== 'no_op') {
    validateLocalEvidenceRefs(root, decision.evidence_refs, `Inspector ${decision.route}`);
  }

  if (decision.route === 'evolution') {
    const traceObservations = new Map(
      digest.observations.map(observation => [observation.trace_ref, observation]),
    );
    const distinctTraceRefs = new Set(decision.evidence_refs.filter(ref => traceRefs.has(ref)));
    const distinctSessions = new Set(
      [...distinctTraceRefs]
        .map(ref => traceObservations.get(ref))
        .filter((value): value is EvolutionDigest['observations'][number] => Boolean(value))
        .map(observation => observation.parent_session_id || observation.session_id),
    );
    if (distinctTraceRefs.size < 2) {
      throw new Error('Inspector evolution requires two digest-owned source trace refs');
    }
    if (distinctSessions.size < 2) {
      throw new Error('Inspector evolution requires evidence from two independent task lineages');
    }
  }

  if (decision.replay_case) {
    assertRefsOwnedBy(
      decision.replay_case.source_trace_refs,
      new Set([
        ...traceRefs,
        ...(pendingSeed?.value.replay_case?.source_trace_refs || []),
      ]),
      'Inspector replay_case.source_trace_refs',
    );
    assertRefsOwnedBy(
      decision.replay_case.source_trace_refs,
      new Set(decision.evidence_refs),
      'Inspector replay source refs must also appear in evidence_refs',
    );
  }
}

function validateEvolutionEvidence(
  decision: EvolutionCandidateDecision,
  inspector: EvolutionInspectorDecision,
): void {
  assertRefsOwnedBy(
    decision.evidence_refs,
    new Set(inspector.evidence_refs),
    'Evolution evidence_refs',
  );
  if (
    decision.evidence_refs.length !== inspector.evidence_refs.length
    || inspector.evidence_refs.some(ref => !decision.evidence_refs.includes(ref))
  ) {
    throw new Error('Evolution must preserve the Inspector evidence set exactly');
  }
}

function assertRefsOwnedBy(refs: string[], allowed: Set<string>, name: string): void {
  const invalid = refs.find(ref => !allowed.has(ref));
  if (invalid) {
    throw new Error(`${name} contains an unowned ref: ${invalid}`);
  }
}

function validateLocalEvidenceRefs(root: string, refs: string[], owner: string): void {
  if (refs.length === 0) {
    throw new Error(`${owner} requires at least one local evidence ref`);
  }
  const resolvedRoot = path.resolve(root);
  const realRoot = fs.realpathSync(resolvedRoot);
  for (const ref of refs) {
    const filePart = ref.split('#', 1)[0]?.trim();
    if (!filePart) throw new Error(`${owner} contains an invalid evidence ref: ${ref}`);
    const resolved = path.resolve(resolvedRoot, filePart);
    if (!isInsideRoot(resolvedRoot, resolved) || !fs.existsSync(resolved)) {
      throw new Error(`${owner} evidence does not exist inside the project: ${ref}`);
    }
    const real = fs.realpathSync(resolved);
    if (!isInsideRoot(realRoot, real)) {
      throw new Error(`${owner} evidence escapes the project through a symlink: ${ref}`);
    }
  }
}

function validateReviewerEvidenceRefs(
  root: string,
  runRoot: string,
  refs: string[],
  owner: string,
): void {
  if (refs.length === 0) {
    throw new Error(`${owner} requires at least one fresh reviewer-replay evidence ref`);
  }
  const resolvedRoot = path.resolve(root);
  const replayRoot = path.resolve(runRoot, 'reviewer-replay');
  if (!isInsideRoot(resolvedRoot, replayRoot) || !fs.existsSync(replayRoot)) {
    throw new Error(`${owner} requires fresh evidence under this run's reviewer-replay directory`);
  }
  if (fs.lstatSync(replayRoot).isSymbolicLink()) {
    throw new Error(`${owner} reviewer-replay directory must not be a symlink`);
  }
  const realReplayRoot = fs.realpathSync(replayRoot);
  const realRoot = fs.realpathSync(resolvedRoot);
  if (!isInsideRoot(realRoot, realReplayRoot)) {
    throw new Error(`${owner} reviewer-replay directory escapes the project through a symlink`);
  }

  for (const ref of refs) {
    const filePart = ref.split('#', 1)[0]?.trim();
    if (!filePart || path.isAbsolute(filePart)) {
      throw new Error(`${owner} contains an invalid reviewer-replay evidence ref: ${ref}`);
    }
    const resolved = path.resolve(resolvedRoot, filePart);
    if (resolved === replayRoot || !isInsideRoot(replayRoot, resolved) || !fs.existsSync(resolved)) {
      throw new Error(`${owner} evidence must exist under this run's reviewer-replay directory: ${ref}`);
    }
    const replayRelative = path.relative(replayRoot, resolved).replace(/\\/g, '/');
    if (replayRelative.includes('/') || !REVIEWER_REPLAY_EVIDENCE_FILES.has(replayRelative)) {
      throw new Error(`${owner} evidence must reference a deterministic reviewer_trace_replay result: ${ref}`);
    }
    const real = fs.realpathSync(resolved);
    if (!isInsideRoot(realReplayRoot, real)) {
      throw new Error(`${owner} evidence escapes this run's reviewer-replay directory through a symlink: ${ref}`);
    }
    if (!fs.statSync(real).isFile()) {
      throw new Error(`${owner} evidence must reference a file: ${ref}`);
    }
  }
}

function findPendingNextRunSeed(root: string, targetDate: string): PendingNextRunSeed | undefined {
  const sleepRoot = path.join(root, 'output', 'evolution', 'sleep');
  if (!fs.existsSync(sleepRoot)) return undefined;
  const priorDates = fs.readdirSync(sleepRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && entry.name < targetDate)
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left));
  const consumed = new Set<string>();
  for (const date of priorDates) {
    const manifest = readJsonObject(path.join(sleepRoot, date, 'dag-run.json'));
    const terminal = manifest?.terminal && typeof manifest.terminal === 'object' && !Array.isArray(manifest.terminal)
      ? manifest.terminal as Record<string, unknown>
      : undefined;
    if (
      typeof manifest?.next_run_seed_input_ref === 'string'
      && (terminal?.status === 'closed' || terminal?.status === 'next_run')
    ) {
      consumed.add(manifest.next_run_seed_input_ref);
    }
  }
  for (const date of priorDates) {
    const seedPath = path.join(sleepRoot, date, 'next-run-seed.json');
    const consumedMarkerPath = path.join(sleepRoot, date, 'next-run-seed-consumed.json');
    const ref = displayPath(seedPath, root);
    if (consumed.has(ref) || fs.existsSync(consumedMarkerPath) || !fs.existsSync(seedPath)) continue;
    if (fs.lstatSync(seedPath).isSymbolicLink()) continue;
    const realSeed = fs.realpathSync(seedPath);
    if (!isInsideRoot(fs.realpathSync(root), realSeed)) continue;
    const parsed = parsePendingNextRunSeed(seedPath);
    if (parsed) return { ref, path: seedPath, value: parsed };
  }
  return undefined;
}

function readUnresolvedSameDateRun(
  root: string,
  runRoot: string,
  manifestPath: string,
): EvolutionDagManifest | undefined {
  if (!fs.existsSync(manifestPath) || fs.lstatSync(manifestPath).isSymbolicLink()) {
    return undefined;
  }
  const realRoot = fs.realpathSync(root);
  const realManifest = fs.realpathSync(manifestPath);
  if (!isInsideRoot(realRoot, realManifest)) return undefined;
  const manifest = readJsonObject(manifestPath);
  const terminal = manifest?.terminal && typeof manifest.terminal === 'object' && !Array.isArray(manifest.terminal)
    ? manifest.terminal as Record<string, unknown>
    : undefined;
  const seedPath = path.join(runRoot, 'next-run-seed.json');
  const consumedPath = path.join(runRoot, 'next-run-seed-consumed.json');
  if (
    manifest?.version !== 1
    || manifest.run_id !== `evolution-dag-${String(manifest.target_date || '')}`
    || manifest.target_date !== path.basename(runRoot)
    || manifest.status !== 'completed'
    || !Array.isArray(manifest.stages)
    || terminal?.status !== 'next_run'
    || terminal.next_run_seed_ref !== displayPath(seedPath, root)
    || !fs.existsSync(seedPath)
    || fs.existsSync(consumedPath)
    || fs.lstatSync(seedPath).isSymbolicLink()
    || !parsePendingNextRunSeed(seedPath)
  ) {
    return undefined;
  }
  const realSeed = fs.realpathSync(seedPath);
  if (!isInsideRoot(realRoot, realSeed)) return undefined;
  return manifest as unknown as EvolutionDagManifest;
}

function readPromotedSameDateRun(
  root: string,
  runRoot: string,
  manifestPath: string,
): EvolutionDagManifest | undefined {
  const receiptPath = path.join(runRoot, 'promotion.json');
  const manifest = readJsonObject(manifestPath);
  const terminal = manifest?.terminal && typeof manifest.terminal === 'object' && !Array.isArray(manifest.terminal)
    ? manifest.terminal as Record<string, unknown>
    : undefined;
  const hasReceipt = fs.existsSync(receiptPath);
  const hasPromotionLink = terminal?.promotion_ref !== undefined;
  if (!hasReceipt && !hasPromotionLink) return undefined;

  const reject = (reason: string): never => {
    throw new Error(`EVOLUTION_SAME_DATE_PROMOTION_PROTECTED：${reason}`);
  };
  if (!manifest || !terminal || !hasReceipt) reject('promotion evidence is incomplete; rerun explicit promote before sleep');
  const protectedManifest = manifest as Record<string, unknown>;
  const protectedTerminal = terminal as Record<string, unknown>;
  if (fs.lstatSync(receiptPath).isSymbolicLink()) reject('promotion receipt cannot be a symlink');
  const realRoot = fs.realpathSync(root);
  const realReceipt = fs.realpathSync(receiptPath);
  if (!isInsideRoot(realRoot, realReceipt) || !fs.statSync(realReceipt).isFile()) {
    reject('promotion receipt escapes the project');
  }
  try {
    verifyPromotionReceiptRawEvidence({ projectRoot: root, receiptPath });
  } catch (error) {
    reject(`promotion raw evidence is no longer immutable: ${errorMessage(error)}`);
  }
  const receipt = readJsonObject(receiptPath);
  const authority = receipt?.authority && typeof receipt.authority === 'object' && !Array.isArray(receipt.authority)
    ? receipt.authority as Record<string, unknown>
    : undefined;
  const evidence = receipt?.evidence && typeof receipt.evidence === 'object' && !Array.isArray(receipt.evidence)
    ? receipt.evidence as Record<string, unknown>
    : undefined;
  const production = receipt?.production && typeof receipt.production === 'object' && !Array.isArray(receipt.production)
    ? receipt.production as Record<string, unknown>
    : undefined;
  const receiptRef = displayPath(receiptPath, root);
  if (
    protectedManifest.version !== 1
    || protectedManifest.run_id !== `evolution-dag-${String(protectedManifest.target_date || '')}`
    || protectedManifest.target_date !== path.basename(runRoot)
    || protectedManifest.status !== 'completed'
    || protectedManifest.route !== 'evolution'
    || protectedTerminal.status !== 'arena_complete'
    || protectedTerminal.arena_decision !== 'pass'
    || protectedTerminal.promotion_recommendation !== 'promote'
    || protectedTerminal.promotion_ref !== receiptRef
    || receipt?.version !== 1
    || receipt.state !== 'promoted'
    || authority?.kind !== 'explicit_cli'
    || evidence?.dag_ref !== displayPath(manifestPath, root)
    || !production
  ) {
    reject('promotion receipt and DAG links are inconsistent');
  }
  const protectedProduction = production as Record<string, unknown>;
  const productionRef = typeof protectedProduction.ref === 'string' ? protectedProduction.ref : '';
  const productionPath = path.resolve(root, productionRef);
  if (
    !productionRef
    || !isInsideRoot(root, productionPath)
    || !fs.existsSync(productionPath)
    || fs.lstatSync(productionPath).isSymbolicLink()
    || !fs.statSync(productionPath).isDirectory()
    || !isInsideRoot(realRoot, fs.realpathSync(productionPath))
  ) {
    reject('promoted production capability is missing or unsafe');
  }
  if (
    typeof protectedProduction.fingerprint !== 'string'
    || protectedProduction.fingerprint !== fingerprintArenaDirectory(productionPath)
  ) {
    reject('promoted production capability fingerprint no longer matches its receipt');
  }
  const arenaRunRef = typeof evidence?.arena_run_ref === 'string' ? evidence.arena_run_ref : '';
  const arenaRunPath = path.resolve(root, arenaRunRef);
  if (
    !arenaRunRef
    || !isInsideRoot(root, arenaRunPath)
    || !fs.existsSync(arenaRunPath)
    || fs.lstatSync(arenaRunPath).isSymbolicLink()
    || !fs.statSync(arenaRunPath).isFile()
    || !isInsideRoot(realRoot, fs.realpathSync(arenaRunPath))
  ) {
    reject('Arena run promotion evidence is missing or unsafe');
  }
  const arenaRun = readJsonObject(arenaRunPath);
  const arenaPromotion = arenaRun?.promotion && typeof arenaRun.promotion === 'object' && !Array.isArray(arenaRun.promotion)
    ? arenaRun.promotion as Record<string, unknown>
    : undefined;
  if (
    !arenaPromotion
    || arenaPromotion.status !== 'promoted'
    || arenaPromotion.production_ref !== productionRef
    || arenaPromotion.receipt_ref !== receiptRef
  ) {
    reject('Arena run promotion link is missing or inconsistent');
  }
  return protectedManifest as unknown as EvolutionDagManifest;
}

function markNextRunSeedConsumed(
  seed: PendingNextRunSeed,
  consumedBy: string,
  consumedAt: string,
): void {
  atomicWriteJson(path.join(path.dirname(seed.path), 'next-run-seed-consumed.json'), {
    version: 1,
    seed_ref: seed.ref,
    consumed_by: consumedBy,
    consumed_at: consumedAt,
  });
}

function parsePendingNextRunSeed(filePath: string): PendingNextRunSeed['value'] | undefined {
  try {
    const value = readJsonObject(filePath);
    if (!value || value.version !== 1) return undefined;
    const source = readEnum(value.source, ['engineer-cat', 'reviewer-cat'], 'next_run.source');
    const replayCase = value.replay_case === undefined ? undefined : parseReplayCase(value.replay_case);
    return {
      version: 1,
      source,
      summary: readRequiredString(value.summary, 'next_run.summary'),
      evidence_refs: uniqueStrings(readStringArray(value.evidence_refs)),
      ...(replayCase ? { replay_case: replayCase } : {}),
      created_at: readRequiredString(value.created_at, 'next_run.created_at'),
    };
  } catch {
    return undefined;
  }
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertRealPathInside(root: string, candidate: string, owner: string): void {
  const realRoot = fs.realpathSync(path.resolve(root));
  const realCandidate = fs.realpathSync(path.resolve(candidate));
  if (!isInsideRoot(realRoot, realCandidate)) {
    throw new Error(`${owner} escapes its trusted root through a symlink`);
  }
}

function resetOwnedDirectory(root: string, directory: string, owner: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  if (resolvedDirectory === resolvedRoot || !isInsideRoot(resolvedRoot, resolvedDirectory)) {
    throw new Error(`${owner} is outside its trusted root`);
  }
  if (fs.existsSync(resolvedDirectory)) {
    if (fs.lstatSync(resolvedDirectory).isSymbolicLink()) {
      fs.unlinkSync(resolvedDirectory);
    } else {
      fs.rmSync(resolvedDirectory, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  assertRealPathInside(resolvedRoot, resolvedDirectory, owner);
}

function parseReplayCase(value: unknown): EvolutionReplayCase {
  const replay = asObject(value, 'Inspector.replay_case');
  const sourceTraceRefs = uniqueStrings(readStringArray(replay.source_trace_refs));
  if (sourceTraceRefs.length === 0) {
    throw new Error('Inspector replay_case requires source_trace_refs');
  }
  return {
    id: readSafeName(replay.id, 'Inspector.replay_case.id'),
    intent: readRequiredString(replay.intent, 'Inspector.replay_case.intent'),
    expected_outcome: readRequiredString(replay.expected_outcome, 'Inspector.replay_case.expected_outcome'),
    source_trace_refs: sourceTraceRefs,
  };
}

function beginStage(
  manifest: EvolutionDagManifest,
  manifestPath: string,
  stage: Omit<EvolutionDagStageRecord, 'status'>,
): EvolutionDagStageRecord {
  const record: EvolutionDagStageRecord = { ...stage, status: 'running' };
  manifest.stages.push(record);
  writeManifest(manifestPath, manifest);
  return record;
}

function completeStage(
  stage: EvolutionDagStageRecord,
  manifest: EvolutionDagManifest,
  manifestPath: string,
  output: Pick<EvolutionDagStageRecord, 'output_ref' | 'summary'>,
): void {
  stage.status = 'completed';
  if (output.output_ref) stage.output_ref = output.output_ref;
  if (output.summary) stage.summary = output.summary;
  writeManifest(manifestPath, manifest);
}

function finishManifest(
  manifest: EvolutionDagManifest,
  manifestPath: string,
  now: () => Date,
  terminal: NonNullable<EvolutionDagManifest['terminal']>,
  status: EvolutionDagManifest['status'] = 'completed',
): EvolutionDagManifest {
  manifest.status = status;
  manifest.terminal = terminal;
  manifest.completed_at = now().toISOString();
  writeManifest(manifestPath, manifest);
  return manifest;
}

function writeManifest(filePath: string, manifest: EvolutionDagManifest): void {
  atomicWriteJson(filePath, manifest);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function parseJsonObject(raw: string, owner: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next bounded representation.
    }
  }
  throw new Error(`${owner} did not return one valid JSON object`);
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, name: string): string {
  const result = readOptionalString(value);
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
}

function requireVersion1(value: Record<string, unknown>, owner: string): void {
  if (value.version !== 1) {
    throw new Error(`${owner}.version must be 1`);
  }
}

function readSafeName(value: unknown, name: string): string {
  const result = readRequiredString(value, name);
  if (!/^[a-z0-9_-]+$/.test(result)) {
    throw new Error(`${name} must match ^[a-z0-9_-]+$`);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'candidate';
}

function displayPath(filePath: string, root: string): string {
  const relative = path.relative(root, path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, '/')
    : path.resolve(filePath).replace(/\\/g, '/');
}
