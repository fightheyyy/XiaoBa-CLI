import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import {
  buildArenaTargetProfile,
  deriveArenaSubjectId,
  fingerprintArenaDirectory,
} from './arena-manager';
import {
  ArenaInspectorCase,
  buildReplayTargets,
  canonicalReplaySourceRef,
  decideArenaRun,
  resolveArenaReplayConfig,
} from './arena-runner';
import { SkillParser } from '../skills/skill-parser';
import {
  collectTraceFactsFromFile,
  extractTraceReplayInputs,
  traceReplayReportPassed,
  TraceReplayComparison,
  TraceReplayTurnResult,
} from '../replay/trace-replay-runner';
import { ArenaOutputContractCheck, ArenaSubjectManifest, ArenaTargetProfile } from './types';
import {
  ArenaTraceIdentityCheck,
  ArenaTraceOutputContract,
  attestArenaTraceRuns,
  enforceGlobalTraceIdUniqueness,
  summarizeArenaOutputContract,
  summarizeArenaTraceIdentity,
} from './trace-attestation';

type JsonObject = Record<string, unknown>;
type CandidateType = 'skill' | 'role';

export interface PromoteEvolutionCandidateOptions {
  workingDirectory: string;
  targetDate: string;
  confirmName: string;
  now?: () => Date;
}

export interface EvolutionPromotionResult {
  status: 'promoted' | 'already_promoted';
  promotion_id: string;
  candidate_type: CandidateType;
  candidate_name: string;
  subject_id: string;
  subject_fingerprint: string;
  production_ref: string;
  receipt_ref: string;
}

interface ValidatedPromotionEvidence {
  root: string;
  runRoot: string;
  dagPath: string;
  dag: JsonObject;
  digestPath: string;
  inspectorPath: string;
  candidateDecisionPath: string;
  arenaResultPath: string;
  arenaRunPath: string;
  arenaRun: JsonObject;
  scorecardPath: string;
  subjectManifestPath: string;
  snapshotRoot: string;
  candidateType: CandidateType;
  candidateName: string;
  subjectId: string;
  subjectFingerprint: string;
  payloadFingerprint: string;
  rawEvidencePaths: string[];
}

interface ValidatedArenaReplayPlan {
  inspectorCasesPath: string;
  arenaRunnerPath: string;
  inspectorCases: ArenaInspectorCase[];
  replayAttempts: {
    planned: number;
    completed: number;
    pass_count: number;
    fail_count: number;
    blocked_count: number;
  };
}

interface PromotionReceipt {
  version: 1;
  promotion_id: string;
  state: 'prepared' | 'promoted';
  authority: {
    kind: 'explicit_cli';
    confirmed_name: string;
  };
  candidate: {
    type: CandidateType;
    name: string;
    previous_status: 'candidate';
    status: 'active';
  };
  evidence: {
    dag_ref: string;
    digest_ref: string;
    inspector_ref: string;
    candidate_decision_ref: string;
    arena_result_ref: string;
    arena_run_ref: string;
    scorecard_ref: string;
    subject_manifest_ref: string;
    subject_id: string;
    subject_fingerprint: string;
    snapshot_ref: string;
    payload_fingerprint: string;
    sha256: Record<string, string>;
    raw_sha256: Record<string, string>;
  };
  production: {
    ref: string;
    fingerprint?: string;
  };
  created_at: string;
  promoted_at?: string;
}

export function promoteEvolutionCandidate(
  options: PromoteEvolutionCandidateOptions,
): EvolutionPromotionResult {
  if (process.env.XIAOBA_ARENA === '1') {
    throw new Error('Evolution promotion is forbidden inside an Arena runtime.');
  }
  assertDate(options.targetDate);
  const root = fs.realpathSync(path.resolve(options.workingDirectory));
  assertExistingDirectory(root, path.join(root, 'output'), 'Promotion output root');
  assertExistingDirectory(root, path.join(root, 'output', 'evolution'), 'Promotion evidence root');
  const now = options.now || (() => new Date());

  return withPromotionLock(root, () => {
    const evidence = validatePromotionEvidence(root, options.targetDate, options.confirmName);
    const receiptPath = path.join(evidence.runRoot, 'promotion.json');
    const receiptRef = relativeRef(root, receiptPath);
    const productionRoot = path.join(root, evidence.candidateType === 'skill' ? 'skills' : 'roles');
    const productionPath = path.join(productionRoot, evidence.candidateName);
    const productionRef = relativeRef(root, productionPath);
    const promotionId = `${requiredString(evidence.dag.run_id, 'dag.run_id')}:${evidence.subjectId}`;
    validateLinkSlots(evidence, receiptRef, productionRef);
    const existingReceipt = inspectPromotionReceiptSlot(receiptPath)
      ? readAndValidateReceipt(receiptPath, promotionId, evidence, productionRef)
      : undefined;

    if (fs.existsSync(productionPath)) {
      if (!existingReceipt) {
        throw new Error(`Promotion target already exists without this receipt: ${productionRef}`);
      }
      validateActiveProduction(productionPath, evidence);
      if (
        existingReceipt.state === 'promoted'
        && existingReceipt.production.fingerprint !== fingerprintArenaDirectory(productionPath)
      ) {
        throw new Error('Existing promotion receipt production fingerprint no longer matches the active target.');
      }
      const finalReceipt = finalizeReceipt(
        existingReceipt,
        productionPath,
        existingReceipt.promoted_at || now().toISOString(),
      );
      atomicWritePromotionReceipt(receiptPath, finalReceipt);
      linkPromotionEvidence(evidence, receiptRef, productionRef);
      return promotionResult(
        existingReceipt.state === 'promoted' ? 'already_promoted' : 'promoted',
        finalReceipt,
        evidence,
        productionRef,
        receiptRef,
      );
    }

    if (existingReceipt?.state === 'promoted') {
      throw new Error(`Promoted receipt exists but production target is missing: ${productionRef}`);
    }

    ensureOwnedDirectory(root, productionRoot, 'Production capability root');
    const preparedReceipt = existingReceipt || buildPreparedReceipt({
      evidence,
      promotionId,
      productionRef,
      confirmedName: options.confirmName,
      createdAt: now().toISOString(),
    });
    if (!existingReceipt) atomicWritePromotionReceipt(receiptPath, preparedReceipt);

    const stagingPath = path.join(
      productionRoot,
      `.xiaoba-promote-${evidence.candidateName}-${evidence.subjectId}.tmp`,
    );
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
    fs.cpSync(evidence.snapshotRoot, stagingPath, { recursive: true });
    if (fingerprintArenaDirectory(stagingPath) !== evidence.subjectFingerprint) {
      fs.rmSync(stagingPath, { recursive: true, force: true });
      throw new Error('Staged package fingerprint does not match the evaluated Arena snapshot.');
    }
    activateOuterLifecycle(stagingPath, evidence.candidateType);
    if (payloadFingerprint(stagingPath, evidence.candidateType) !== evidence.payloadFingerprint) {
      fs.rmSync(stagingPath, { recursive: true, force: true });
      throw new Error('Promotion changed evaluated payload beyond candidate -> active lifecycle.');
    }
    if (fs.existsSync(productionPath)) {
      fs.rmSync(stagingPath, { recursive: true, force: true });
      throw new Error(`Promotion target appeared during materialization: ${productionRef}`);
    }
    fs.renameSync(stagingPath, productionPath);
    validateActiveProduction(productionPath, evidence);

    const finalReceipt = finalizeReceipt(preparedReceipt, productionPath, now().toISOString());
    atomicWritePromotionReceipt(receiptPath, finalReceipt);
    linkPromotionEvidence(evidence, receiptRef, productionRef);
    return promotionResult(
      'promoted',
      finalReceipt,
      evidence,
      productionRef,
      receiptRef,
    );
  });
}

export function verifyPromotionReceiptRawEvidence(input: {
  projectRoot: string;
  receiptPath: string;
}): void {
  const requestedRoot = path.resolve(input.projectRoot);
  const root = fs.realpathSync(requestedRoot);
  const requestedReceipt = path.resolve(input.receiptPath);
  const receiptRelative = path.relative(requestedRoot, requestedReceipt);
  if (receiptRelative.startsWith('..') || path.isAbsolute(receiptRelative)) {
    throw new Error('Promotion receipt escapes the project root.');
  }
  const receiptPath = canonicalFile(root, path.resolve(root, receiptRelative), 'Promotion receipt');
  const receipt = readJson(receiptPath);
  const evidence = requiredObject(receipt.evidence, 'receipt.evidence');
  const rawHashes = requiredObject(evidence.raw_sha256, 'receipt.evidence.raw_sha256');
  const expectedRefs = collectReceiptRawEvidenceRefs(root, evidence);
  const actualRefs = Object.keys(rawHashes).sort();
  if (!sameStrings(actualRefs, expectedRefs)) {
    throw new Error('Promotion receipt raw evidence hash set does not exactly match the consumed evidence refs.');
  }
  for (const ref of expectedRefs) {
    const expectedHash = sha256Value(rawHashes[ref], `receipt.evidence.raw_sha256[${ref}]`);
    const evidencePath = resolveCanonicalRawEvidenceRef(root, ref, `Promotion raw evidence ${ref}`);
    if (hashFile(evidencePath) !== expectedHash) {
      throw new Error(`Promotion raw evidence content drifted after evaluation: ${ref}`);
    }
  }
}

function collectReceiptRawEvidenceRefs(root: string, evidence: JsonObject): string[] {
  const inspectorPath = resolveCanonicalRawEvidenceRef(
    root,
    requiredString(evidence.inspector_ref, 'receipt.evidence.inspector_ref'),
    'Receipt Inspector route',
  );
  const inspector = readJson(inspectorPath);
  const inspectorTracePaths = strictStringArray(inspector.evidence_refs, 'receipt Inspector evidence_refs')
    .map((ref, index) => resolveExistingRef(root, ref, `Receipt Inspector source trace ${index + 1}`));

  const scorecardPath = resolveCanonicalRawEvidenceRef(
    root,
    requiredString(evidence.scorecard_ref, 'receipt.evidence.scorecard_ref'),
    'Receipt Arena scorecard',
  );
  const scorecard = readJson(scorecardPath);
  const arenaRunId = safeRunId(scorecard.arena_run_id, 'receipt Arena scorecard arena_run_id');
  const expectedRunRoot = path.join(root, 'arena', 'runs', arenaRunId);
  if (path.dirname(scorecardPath) !== expectedRunRoot) {
    throw new Error('Receipt Arena scorecard is not stored in its canonical run root.');
  }
  const scorecardDebugRefs = requiredObject(scorecard.debug_refs, 'receipt Arena scorecard debug_refs');
  const inspectorCasesPath = resolveCanonicalRawEvidenceRef(
    root,
    requiredString(
      scorecardDebugRefs.inspector_cases,
      'receipt Arena scorecard debug_refs.inspector_cases',
    ),
    'Receipt Arena Inspector cases artifact',
  );
  const expectedInspectorCasesPath = canonicalFile(
    root,
    path.join(expectedRunRoot, 'debug', 'inspector-cases.json'),
    'Receipt Arena Inspector cases artifact',
  );
  if (inspectorCasesPath !== expectedInspectorCasesPath) {
    throw new Error('Receipt Arena Inspector cases ref is not canonical for its run.');
  }
  const arenaRunnerPath = canonicalFile(
    root,
    path.join(expectedRunRoot, 'arena-runner.json'),
    'Receipt Arena runner artifact',
  );
  const scorecardEvidence = requiredObject(scorecard.evidence, 'receipt Arena scorecard evidence');
  const nativeTracePaths = strictStringArray(
    scorecardEvidence.trace_refs,
    'receipt Arena scorecard evidence.trace_refs',
  ).map((ref, index) => resolveCanonicalRawEvidenceRef(root, ref, `Receipt Arena native trace ${index + 1}`));
  const replayResults = Array.isArray(scorecard.replay_results)
    ? scorecard.replay_results.map((value, index) => requiredObject(value, `receipt replay_results[${index}]`))
    : [];
  const replayPaths = replayResults.flatMap((result, index) => {
    const artifacts = resolveReplayArtifactPaths(root, result, index, `Receipt replay result ${index + 1}`);
    return [
      artifacts.manifestPath,
      artifacts.inputsPath,
      artifacts.resultsPath,
      artifacts.comparisonPath,
      resolveCanonicalRawEvidenceRef(
        root,
        requiredString(result.source_trace_ref, `receipt replay_results[${index}].source_trace_ref`),
        `Receipt replay source trace ${index + 1}`,
      ),
      resolveCanonicalRawEvidenceRef(
        root,
        requiredString(result.fresh_trace_ref, `receipt replay_results[${index}].fresh_trace_ref`),
        `Receipt replay fresh trace ${index + 1}`,
      ),
    ];
  });
  return uniquePaths([
    ...inspectorTracePaths,
    inspectorCasesPath,
    arenaRunnerPath,
    ...nativeTracePaths,
    ...replayPaths,
  ])
    .map(filePath => relativeRef(root, filePath))
    .sort();
}

function validatePromotionEvidence(
  root: string,
  targetDate: string,
  confirmName: string,
): ValidatedPromotionEvidence {
  const runRoot = path.join(root, 'output', 'evolution', 'sleep', targetDate);
  assertExistingDirectory(root, runRoot, 'Evolution run root');
  const dagPath = canonicalFile(root, path.join(runRoot, 'dag-run.json'), 'DAG manifest');
  const dag = readJson(dagPath);
  if (
    dag.version !== 1
    || dag.run_id !== `evolution-dag-${targetDate}`
    || dag.target_date !== targetDate
    || dag.status !== 'completed'
    || dag.route !== 'evolution'
  ) {
    throw new Error('Promotion requires one completed canonical evolution DAG.');
  }
  requireSamePath(root, requiredString(dag.manifest_ref, 'dag.manifest_ref'), dagPath, 'DAG manifest');
  const terminal = requiredObject(dag.terminal, 'dag.terminal');
  if (
    terminal.status !== 'arena_complete'
    || terminal.arena_decision !== 'pass'
    || terminal.promotion_recommendation !== 'promote'
  ) {
    throw new Error('Promotion requires terminal Arena pass and promote recommendation.');
  }

  const digestPath = canonicalFile(root, path.join(runRoot, 'digest.json'), 'Evolution digest');
  requireSamePath(root, requiredString(dag.digest_ref, 'dag.digest_ref'), digestPath, 'Evolution digest');
  requireStageOutput(root, dag, 'harvest', digestPath);
  const digest = readJson(digestPath);
  if (
    digest.schema_version !== 1
    || digest.run_id !== `sleep-${targetDate}`
    || digest.source !== 'xiaoba_session_log_v3'
    || requiredObject(digest.window, 'digest.window').target_date !== targetDate
  ) {
    throw new Error('Promotion requires the canonical digest for this evolution date.');
  }

  const inspectorPath = canonicalFile(root, path.join(runRoot, 'inspector-route.json'), 'Inspector route');
  requireSamePath(root, requiredString(dag.inspector_ref, 'dag.inspector_ref'), inspectorPath, 'Inspector route');
  requireStageOutput(root, dag, 'inspector', inspectorPath);
  const inspector = readJson(inspectorPath);
  if (inspector.version !== 1 || inspector.route !== 'evolution') {
    throw new Error('Promotion requires Inspector route=evolution.');
  }
  const inspectorEvidence = uniqueStringArray(inspector.evidence_refs, 'Inspector evidence_refs');
  if (inspectorEvidence.length < 2) {
    throw new Error('Inspector evolution evidence requires at least two distinct refs.');
  }
  validateIndependentLineages(root, digest, inspectorEvidence);

  const candidateDecisionPath = canonicalFile(
    root,
    path.join(runRoot, 'evolution-candidate.json'),
    'Evolution candidate decision',
  );
  requireStageOutput(root, dag, 'evolution', candidateDecisionPath);
  const candidateDecision = readJson(candidateDecisionPath);
  if (candidateDecision.version !== 1 || candidateDecision.status !== 'candidate') {
    throw new Error('Promotion requires an Evolution candidate decision.');
  }
  const candidateEvidence = uniqueStringArray(candidateDecision.evidence_refs, 'Candidate evidence_refs');
  if (!sameStringSet(candidateEvidence, inspectorEvidence)) {
    throw new Error('Candidate evidence must exactly preserve Inspector evidence.');
  }
  const candidate = requiredObject(candidateDecision.candidate, 'candidate');
  const candidateType = enumValue(candidate.type, ['skill', 'role'], 'candidate.type');
  const candidateName = safeName(candidate.name, 'candidate.name');
  if (confirmName !== candidateName) {
    throw new Error(`--confirm must exactly equal Candidate name: ${candidateName}`);
  }
  const candidatePackageRoot = resolveCandidatePackage(
    runRoot,
    candidateType,
    candidateName,
    requiredString(candidate.path, 'candidate.path'),
  );
  const candidateRef = requiredString(terminal.candidate_ref, 'dag.terminal.candidate_ref');
  if (candidateType === 'skill') {
    requireSamePath(root, candidateRef, path.join(candidatePackageRoot, 'SKILL.md'), 'DAG candidate');
  } else {
    requireSameDirectoryPath(root, candidateRef, candidatePackageRoot, 'DAG candidate');
  }
  assertCandidateLifecycle(candidatePackageRoot, candidateType, candidateName);
  const candidateOutputContract = outputContractPrefixes(candidatePackageRoot, candidateType);

  const arenaResultPath = canonicalFile(root, path.join(runRoot, 'arena-result.json'), 'Arena result');
  requireStageOutput(root, dag, 'arena', arenaResultPath);
  const arenaResult = readJson(arenaResultPath);
  if (arenaResult.decision !== 'pass') throw new Error('Arena result must be pass.');
  const arenaRunId = safeRunId(arenaResult.run_id, 'arena_result.run_id');
  const subjectId = safeRunId(arenaResult.subject_id, 'arena_result.subject_id');
  const subjectFingerprint = sha256Value(arenaResult.subject_fingerprint, 'arena_result.subject_fingerprint');
  const canonicalSubjectId = deriveArenaSubjectId(candidateType, candidateName, subjectFingerprint);
  if (subjectId !== canonicalSubjectId) {
    throw new Error(`Arena subject_id is not canonical for the evaluated content: expected ${canonicalSubjectId}.`);
  }

  const scorecardPath = canonicalFile(
    root,
    path.join(root, 'arena', 'runs', arenaRunId, 'arena-scorecard.json'),
    'Arena scorecard',
  );
  requireSamePath(root, requiredString(arenaResult.scorecard_ref, 'arena_result.scorecard_ref'), scorecardPath, 'Arena scorecard');
  requireSamePath(root, requiredString(terminal.arena_run_ref, 'dag.terminal.arena_run_ref'), scorecardPath, 'DAG Arena scorecard');
  const scorecard = readJson(scorecardPath);
  validateScorecard(
    scorecard,
    arenaRunId,
    subjectId,
    candidateType,
    candidateName,
    candidateOutputContract,
    root,
  );

  const arenaRunPath = canonicalFile(
    root,
    path.join(root, 'arena', 'runs', arenaRunId, 'arena-run.json'),
    'Arena run index',
  );
  const scorecardEvidence = requiredObject(scorecard.evidence, 'scorecard.evidence');
  requireSamePath(root, requiredString(scorecardEvidence.arena_run, 'scorecard.evidence.arena_run'), arenaRunPath, 'Arena run index');
  const arenaRun = readJson(arenaRunPath);
  if (
    arenaRun.version !== 1
    || arenaRun.run_id !== arenaRunId
    || arenaRun.subject_id !== subjectId
    || arenaRun.decision !== 'pass'
    || arenaRun.review_mode !== expectedReviewMode(candidateType)
  ) {
    throw new Error('Arena run index does not match the passed scorecard and Candidate type.');
  }
  if (stableJson(scorecard.target_profile) !== stableJson(arenaRun.target_profile)) {
    throw new Error('Arena scorecard and run index target profiles must match exactly.');
  }
  const replayPlan = validateArenaReplayPlan({
    root,
    arenaRunId,
    scorecard,
    arenaRun,
  });
  validateReplayEvidence(scorecard, arenaRun, candidateType, candidateName, candidateOutputContract, root);

  const subjectManifestPath = canonicalFile(
    root,
    path.join(root, 'arena', 'subjects', subjectId, 'arena-manifest.json'),
    'Arena subject manifest',
  );
  requireSamePath(
    root,
    requiredString(arenaResult.subject_manifest_ref, 'arena_result.subject_manifest_ref'),
    subjectManifestPath,
    'Arena subject manifest',
  );
  requireSamePath(
    root,
    requiredString(arenaRun.subject_manifest_path, 'arena_run.subject_manifest_path'),
    subjectManifestPath,
    'Arena run subject manifest',
  );
  const subjectManifest = readJson(subjectManifestPath);
  const subject = requiredObject(subjectManifest.subject, 'subject_manifest.subject');
  const source = requiredObject(subjectManifest.source, 'subject_manifest.source');
  if (
    subjectManifest.version !== 1
    || subjectManifest.subject_id !== subjectId
    || subjectManifest.fingerprint !== subjectFingerprint
    || subject.type !== candidateType
    || subject.name !== candidateName
    || subjectManifest.allowed_runtime !== 'arena_only'
    || subjectManifest.trust_level !== 'review_required'
    || source.type !== (candidateType === 'skill' ? 'local_skill' : 'local_role')
  ) {
    throw new Error('Arena subject manifest does not match the Evolution Candidate.');
  }
  const expectedSnapshotRef = `arena/subjects/${subjectId}/source`;
  if (normalizeRef(requiredString(source.path, 'subject_manifest.source.path')) !== expectedSnapshotRef) {
    throw new Error('Arena subject source must be its canonical immutable snapshot.');
  }
  const snapshotRoot = path.join(root, expectedSnapshotRef);
  assertExistingDirectory(root, snapshotRoot, 'Arena subject snapshot');
  if (fingerprintArenaDirectory(snapshotRoot) !== subjectFingerprint) {
    throw new Error('Arena subject snapshot fingerprint mismatch.');
  }
  const expectedTargetProfile = buildArenaTargetProfile({
    reviewMode: expectedReviewMode(candidateType),
    subject: subjectManifest as unknown as ArenaSubjectManifest,
    targetRoleId: candidateType === 'role' ? candidateName : undefined,
    surface: 'pet',
    rolePath: candidateType === 'role' ? snapshotRoot : undefined,
    workingDirectory: path.join(root, 'arena', 'runs', arenaRunId, 'workspace'),
  });
  validateTargetProfile(
    arenaRun.target_profile,
    candidateType,
    candidateName,
    'Arena run',
    expectedTargetProfile,
  );
  validateTargetProfile(
    scorecard.target_profile,
    candidateType,
    candidateName,
    'Arena scorecard',
    expectedTargetProfile,
  );
  validateManifestProfile(root, subjectManifest, arenaRun.target_profile, candidateType, candidateName, subjectFingerprint);
  if (fingerprintArenaDirectory(candidatePackageRoot) !== subjectFingerprint) {
    throw new Error('Evolution Candidate no longer matches the evaluated Arena snapshot.');
  }
  assertCandidateLifecycle(snapshotRoot, candidateType, candidateName);
  if (!sameOptionalStrings(outputContractPrefixes(snapshotRoot, candidateType), candidateOutputContract)) {
    throw new Error('Candidate and immutable Arena snapshot disagree on output-contract declaration.');
  }
  const rawEvidencePaths = validateRawArenaEvidence({
    root,
    scorecard,
    candidateName,
    candidateOutputContract,
  });
  validateArenaDecisionSemantics(scorecard, replayPlan);

  return {
    root,
    runRoot,
    dagPath,
    dag,
    digestPath,
    inspectorPath,
    candidateDecisionPath,
    arenaResultPath,
    arenaRunPath,
    arenaRun,
    scorecardPath,
    subjectManifestPath,
    snapshotRoot,
    candidateType,
    candidateName,
    subjectId,
    subjectFingerprint,
    payloadFingerprint: payloadFingerprint(snapshotRoot, candidateType),
    rawEvidencePaths: uniquePaths([
      ...inspectorEvidence.map(ref => resolveExistingRef(root, ref, 'Inspector source trace evidence')),
      replayPlan.inspectorCasesPath,
      replayPlan.arenaRunnerPath,
      ...rawEvidencePaths,
    ]),
  };
}

function validateScorecard(
  scorecard: JsonObject,
  arenaRunId: string,
  subjectId: string,
  candidateType: CandidateType,
  candidateName: string,
  candidateOutputContract: string[] | undefined,
  root: string,
): void {
  if (
    scorecard.version !== 1
    || scorecard.scorecard_type !== 'arena'
    || scorecard.arena_run_id !== arenaRunId
    || scorecard.subject_id !== subjectId
    || scorecard.decision !== 'pass'
    || scorecard.review_mode !== expectedReviewMode(candidateType)
    || Object.prototype.hasOwnProperty.call(scorecard, 'arena_run_error')
  ) {
    throw new Error('Promotion requires one consistent Arena-owned pass scorecard.');
  }
  const stages = requiredObject(scorecard.stages, 'scorecard.stages');
  for (const stageName of ['usercat', 'inspector', 'reviewer']) {
    if (requiredObject(stages[stageName], `scorecard.stages.${stageName}`).status !== 'pass') {
      throw new Error(`Arena stage ${stageName} must pass before promotion.`);
    }
  }
  const check = requiredObject(scorecard.output_contract_check, 'scorecard.output_contract_check');
  const declared = booleanValue(check.declared, 'output_contract_check.declared');
  if (declared !== Boolean(candidateOutputContract)) {
    throw new Error('Arena output-contract attestation does not match the evaluated Candidate declaration.');
  }
  const usercatRuns = Array.isArray(scorecard.usercat_runs) ? scorecard.usercat_runs : [];
  if (usercatRuns.length === 0 || usercatRuns.some(run => !isObject(run) || run.status !== 'pass')) {
    throw new Error('Arena scorecard requires successful UserCat run summaries.');
  }
  requiredObject(scorecard.trace_identity_check, 'scorecard.trace_identity_check');
  for (const [index, value] of usercatRuns.entries()) {
    const run = requiredObject(value, `usercat_runs[${index}]`);
    requiredString(run.run_id, `usercat_runs[${index}].run_id`);
    requiredString(run.session_key, `usercat_runs[${index}].session_key`);
    positiveCountValue(run.turn_count, `usercat_runs[${index}].turn_count`);
  }
  const status = enumValue(
    check.status,
    ['pass', 'not_declared', 'blocked', 'fail'],
    'output_contract_check.status',
  );
  if (declared) {
    const expected = countValue(check.expected_turns, 'output_contract_check.expected_turns');
    const checked = countValue(check.checked_turns, 'output_contract_check.checked_turns');
    const passed = countValue(check.passed_turns, 'output_contract_check.passed_turns');
    const violations = countValue(check.violation_count, 'output_contract_check.violation_count');
    const fully = countValue(check.fully_compliant_sessions, 'output_contract_check.fully_compliant_sessions');
    const total = countValue(check.total_sessions, 'output_contract_check.total_sessions');
    const summarizedTurns = usercatRuns.reduce(
      (sum, run) => sum + countValue((run as JsonObject).turn_count, 'usercat_runs.turn_count'),
      0,
    );
    if (
      status !== 'pass'
      || expected <= 0
      || expected !== checked
      || checked !== passed
      || violations !== 0
      || expected !== summarizedTurns
      || total !== usercatRuns.length
      || fully !== total
    ) {
      throw new Error('Declared output contract is not fully compliant across all Arena turns and sessions.');
    }
    const contractSource = resolveExistingRef(
      root,
      requiredString(check.source_ref, 'output_contract_check.source_ref'),
      'Output contract source',
    );
    const attestedSkill = SkillParser.parse(contractSource);
    if (
      candidateType !== 'skill'
      || attestedSkill.metadata.name !== candidateName
      || !sameOptionalStrings(attestedSkill.metadata.arenaOutputLinePrefixes, candidateOutputContract)
    ) {
      throw new Error('Arena output-contract source does not exactly match the evaluated Candidate prefixes.');
    }
  } else if (status !== 'not_declared') {
    throw new Error('Undeclared output contract must carry status=not_declared.');
  } else if (
    countValue(check.expected_turns, 'output_contract_check.expected_turns') !== 0
    || countValue(check.checked_turns, 'output_contract_check.checked_turns') !== 0
    || countValue(check.passed_turns, 'output_contract_check.passed_turns') !== 0
    || countValue(check.violation_count, 'output_contract_check.violation_count') !== 0
    || countValue(check.fully_compliant_sessions, 'output_contract_check.fully_compliant_sessions') !== 0
    || countValue(check.total_sessions, 'output_contract_check.total_sessions') !== usercatRuns.length
    || check.source_ref !== null
  ) {
    throw new Error('Undeclared output contract must not claim checked or compliant turns.');
  }

  const evidence = requiredObject(scorecard.evidence, 'scorecard.evidence');
  const traceRefs = uniqueStringArray(evidence.trace_refs, 'scorecard.evidence.trace_refs');
  if (traceRefs.length === 0) throw new Error('Arena scorecard requires fresh trace refs.');
  for (const ref of traceRefs) resolveExistingRef(root, ref, 'Arena trace evidence');
}

function validateRawArenaEvidence(input: {
  root: string;
  scorecard: JsonObject;
  candidateName: string;
  candidateOutputContract: string[] | undefined;
}): string[] {
  const usercatRuns = Array.isArray(input.scorecard.usercat_runs)
    ? input.scorecard.usercat_runs.map((value, index) => requiredObject(value, `usercat_runs[${index}]`))
    : [];
  if (usercatRuns.length === 0) throw new Error('Arena scorecard has no UserCat trace claims to re-attest.');
  const evidence = requiredObject(input.scorecard.evidence, 'scorecard.evidence');
  const nativeTraceRefs = strictStringArray(evidence.trace_refs, 'scorecard.evidence.trace_refs');
  const nativeTracePaths = nativeTraceRefs.map((ref, index) => (
    resolveCanonicalRawEvidenceRef(input.root, ref, `Arena native trace ${index + 1}`)
  ));
  const outputCheck = requiredObject(input.scorecard.output_contract_check, 'scorecard.output_contract_check');
  const outputContract = candidateTraceOutputContract(input.candidateName, input.candidateOutputContract);
  const usercatSessions = attestArenaTraceRuns({
    projectRoot: input.root,
    claims: usercatRuns.map((run, index) => ({
      runId: requiredString(run.run_id, `usercat_runs[${index}].run_id`),
      sessionKey: requiredString(run.session_key, `usercat_runs[${index}].session_key`),
      expectedTurns: positiveCountValue(run.turn_count, `usercat_runs[${index}].turn_count`),
    })),
    tracePaths: nativeTracePaths,
    ...(outputContract && { outputContract }),
  });
  const expectedIdentity = summarizeArenaTraceIdentity(usercatSessions);
  if (
    expectedIdentity.status !== 'pass'
    || stableJson(requiredObject(input.scorecard.trace_identity_check, 'scorecard.trace_identity_check'))
      !== stableJson(expectedIdentity)
  ) {
    throw new Error('Arena native trace identity check does not exactly match the raw UserCat traces.');
  }
  const expectedOutput = summarizeArenaOutputContract({
    declared: Boolean(outputContract),
    sourceRef: outputContract
      ? requiredString(outputCheck.source_ref, 'output_contract_check.source_ref')
      : null,
    sessions: usercatSessions,
    totalSessions: usercatRuns.length,
  });
  if (
    !['pass', 'not_declared'].includes(expectedOutput.status)
    || stableJson(outputCheck) !== stableJson(expectedOutput)
  ) {
    throw new Error('Arena output-contract check does not exactly match the raw UserCat traces.');
  }

  const replayResults = Array.isArray(input.scorecard.replay_results)
    ? input.scorecard.replay_results.map((value, index) => requiredObject(value, `replay_results[${index}]`))
    : [];
  const scorecardCases = Array.isArray(input.scorecard.cases)
    ? input.scorecard.cases.map((value, index) => requiredObject(value, `cases[${index}]`))
    : [];
  const sourceTracePaths = replayResults.map((result, index) => {
    const caseId = requiredString(result.case_id, `replay_results[${index}].case_id`);
    const sourceTraceRef = requiredString(result.source_trace_ref, `replay_results[${index}].source_trace_ref`);
    const matchingCases = scorecardCases.filter(item => item.case_id === caseId);
    if (matchingCases.length !== 1) {
      throw new Error(`Replay result ${index + 1} case_id must identify exactly one Arena scorecard case.`);
    }
    const evidenceRefs = stringArrayValue(
      matchingCases[0].evidence_refs,
      `Arena case ${caseId}.evidence_refs`,
    );
    if (!evidenceRefs.includes(sourceTraceRef) || path.extname(sourceTraceRef) !== '.jsonl') {
      throw new Error(`Replay result ${index + 1} source_trace_ref is not the selected replayable evidence of case ${caseId}.`);
    }
    return resolveCanonicalRawEvidenceRef(
      input.root,
      sourceTraceRef,
      `Replay source trace ${index + 1}`,
    );
  });
  const replayTracePaths = replayResults.map((result, index) => resolveCanonicalRawEvidenceRef(
    input.root,
    requiredString(result.fresh_trace_ref, `replay_results[${index}].fresh_trace_ref`),
    `Replay fresh trace ${index + 1}`,
  ));
  const replaySessions = attestArenaTraceRuns({
    projectRoot: input.root,
    claims: replayResults.map((result, index) => ({
      runId: requiredString(result.replay_run_id, `replay_results[${index}].replay_run_id`),
      sessionKey: requiredString(result.session_key, `replay_results[${index}].session_key`),
      expectedTurns: positiveCountValue(result.turn_count, `replay_results[${index}].turn_count`),
    })),
    tracePaths: replayTracePaths,
    ...(outputContract && { outputContract }),
  });
  const globallyAttested = enforceGlobalTraceIdUniqueness([...usercatSessions, ...replaySessions]);
  if (globallyAttested.some(session => session.identityBlockedReasons.some(
    reason => reason.includes('is reused across multiple claimed sessions'),
  ))) {
    throw new Error('Arena native and replay trace_id values must be globally unique across every evaluated session.');
  }
  for (const [index, session] of replaySessions.entries()) {
    const result = replayResults[index];
    const expectedReplayIdentity = summarizeArenaTraceIdentity([session]);
    if (
      expectedReplayIdentity.status !== 'pass'
      || stableJson(requiredObject(
        result.trace_identity_check,
        `replay_results[${index}].trace_identity_check`,
      )) !== stableJson(expectedReplayIdentity)
    ) {
      throw new Error(`Replay result ${index + 1} identity check does not exactly match its fresh native trace.`);
    }
    const persistedReplayOutput = requiredObject(
      result.output_contract_check,
      `replay_results[${index}].output_contract_check`,
    );
    const expectedReplayOutput = summarizeArenaOutputContract({
      declared: Boolean(outputContract),
      sourceRef: outputContract
        ? requiredString(persistedReplayOutput.source_ref, `replay_results[${index}].output_contract_check.source_ref`)
        : null,
      sessions: [session],
      totalSessions: 1,
    });
    if (
      !['pass', 'not_declared'].includes(expectedReplayOutput.status)
      || stableJson(persistedReplayOutput) !== stableJson(expectedReplayOutput)
    ) {
      throw new Error(`Replay result ${index + 1} output-contract check does not match its fresh native trace.`);
    }
  }
  const replayArtifactPaths = replayResults.flatMap((result, index) => validateRetainedReplayArtifacts({
    root: input.root,
    result,
    index,
    freshTracePath: replayTracePaths[index],
    sourceTracePath: sourceTracePaths[index],
  }));
  return uniquePaths([...nativeTracePaths, ...sourceTracePaths, ...replayTracePaths, ...replayArtifactPaths]);
}

function validateRetainedReplayArtifacts(input: {
  root: string;
  result: JsonObject;
  index: number;
  freshTracePath: string;
  sourceTracePath: string;
}): string[] {
  const owner = `Replay result ${input.index + 1}`;
  const paths = resolveReplayArtifactPaths(input.root, input.result, input.index, owner);
  const manifest = readJson(paths.manifestPath);
  const runId = requiredString(input.result.replay_run_id, `replay_results[${input.index}].replay_run_id`);
  const sessionKey = requiredString(input.result.session_key, `replay_results[${input.index}].session_key`);
  const turnCount = positiveCountValue(input.result.turn_count, `replay_results[${input.index}].turn_count`);
  if (
    manifest.replay_version !== '0.1'
    || requiredString(manifest.run_id, `${owner} manifest.run_id`) !== runId
    || requiredString(manifest.session_key, `${owner} manifest.session_key`) !== sessionKey
    || positiveCountValue(manifest.replayed_turns, `${owner} manifest.replayed_turns`) !== turnCount
  ) {
    throw new Error(`${owner} manifest does not match its Arena run/session/turn claim.`);
  }
  requireExactArtifactPath(
    input.root,
    manifest.fresh_trace_path,
    input.freshTracePath,
    `${owner} manifest.fresh_trace_path`,
  );
  requireExactArtifactPath(
    input.root,
    manifest.input_trace_path,
    input.sourceTracePath,
    `${owner} manifest.input_trace_path`,
  );
  const artifacts = requiredObject(manifest.artifacts, `${owner} manifest.artifacts`);
  requireExactArtifactPath(input.root, artifacts.manifest_path, paths.manifestPath, `${owner} manifest_path`);
  requireExactArtifactPath(input.root, artifacts.extracted_inputs_path, paths.inputsPath, `${owner} extracted_inputs_path`);
  requireExactArtifactPath(input.root, artifacts.replay_results_path, paths.resultsPath, `${owner} replay_results_path`);
  requireExactArtifactPath(input.root, artifacts.comparison_path, paths.comparisonPath, `${owner} comparison_path`);

  const replayInputs = readJsonArray(paths.inputsPath, `${owner} extracted inputs`)
    .map((value, index) => requiredObject(value, `${owner} inputs[${index}]`));
  const replayResults = readJsonArray(paths.resultsPath, `${owner} replay results`)
    .map((value, index) => requiredObject(value, `${owner} results[${index}]`));
  if (replayInputs.length !== turnCount || replayResults.length !== turnCount) {
    throw new Error(`${owner} retained inputs/results must each contain exactly ${turnCount} turns.`);
  }
  const extractedSourceInputs = extractTraceReplayInputs(input.sourceTracePath, turnCount);
  if (stableJson(replayInputs) !== stableJson(extractedSourceInputs)) {
    throw new Error(`${owner} extracted-inputs artifact does not exactly match its bound source trace.`);
  }
  const inputTexts: string[] = [];
  for (let index = 0; index < turnCount; index += 1) {
    const replayInput = replayInputs[index];
    const replayResult = replayResults[index];
    const expectedIndex = index + 1;
    const sourceLine = positiveCountValue(replayInput.sourceLine, `${owner} inputs[${index}].sourceLine`);
    const status = countValue(replayResult.status, `${owner} results[${index}].status`);
    countValue(replayResult.textEventCount, `${owner} results[${index}].textEventCount`);
    if (replayResult.visibleToUser !== undefined && typeof replayResult.visibleToUser !== 'boolean') {
      throw new Error(`${owner} results[${index}].visibleToUser must be boolean when present.`);
    }
    if (
      positiveCountValue(replayInput.index, `${owner} inputs[${index}].index`) !== expectedIndex
      || positiveCountValue(replayResult.index, `${owner} results[${index}].index`) !== expectedIndex
      || positiveCountValue(replayResult.sourceLine, `${owner} results[${index}].sourceLine`) !== sourceLine
      || replayResult.ok !== true
      || status < 200
      || status >= 300
      || replayResult.error !== undefined
    ) {
      throw new Error(`${owner} retained turn ${expectedIndex} is not a successful index/sourceLine-bound replay.`);
    }
    inputTexts.push(requiredString(replayInput.text, `${owner} inputs[${index}].text`));
  }

  const comparison = readJson(paths.comparisonPath);
  const newTrace = requiredObject(comparison.newTrace, `${owner} comparison.newTrace`);
  const recomputedNewTrace = collectTraceFactsFromFile(input.freshTracePath);
  if (
    comparison.userInputsReplayed !== true
    || !sameStrings(strictStringArray(newTrace.userTexts, `${owner} comparison.newTrace.userTexts`), inputTexts)
    || !sameStrings(readNativeTraceUserTexts(input.freshTracePath, owner), inputTexts)
    || stableJson(newTrace) !== stableJson(recomputedNewTrace)
  ) {
    throw new Error(`${owner} retained inputs do not exactly match the comparison and fresh native trace.`);
  }
  if (!traceReplayReportPassed({
    results: replayResults as unknown as TraceReplayTurnResult[],
    comparison: comparison as unknown as TraceReplayComparison,
  })) {
    throw new Error(`${owner} retained replay evidence does not satisfy the Arena replay pass predicate.`);
  }
  return [paths.manifestPath, paths.inputsPath, paths.resultsPath, paths.comparisonPath];
}

function resolveReplayArtifactPaths(
  root: string,
  result: JsonObject,
  index: number,
  owner: string,
): { manifestPath: string; inputsPath: string; resultsPath: string; comparisonPath: string } {
  const resultsPath = resolveCanonicalRawEvidenceRef(
    root,
    requiredString(result.replay_results_ref, `replay_results[${index}].replay_results_ref`),
    `${owner} replay-results artifact`,
  );
  if (path.basename(resultsPath) !== 'replay-results.json') {
    throw new Error(`${owner} replay_results_ref must name replay-results.json.`);
  }
  const artifactRoot = path.dirname(resultsPath);
  return {
    manifestPath: canonicalFile(root, path.join(artifactRoot, 'manifest.json'), `${owner} manifest artifact`),
    inputsPath: canonicalFile(root, path.join(artifactRoot, 'extracted-inputs.json'), `${owner} extracted-inputs artifact`),
    resultsPath,
    comparisonPath: canonicalFile(root, path.join(artifactRoot, 'comparison.json'), `${owner} comparison artifact`),
  };
}

function requireExactArtifactPath(root: string, value: unknown, expected: string, owner: string): void {
  const declared = requiredString(value, owner);
  let candidate = path.isAbsolute(declared) ? declared : path.resolve(root, declared);
  if (path.isAbsolute(declared)) {
    if (!fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink() || !fs.statSync(candidate).isFile()) {
      throw new Error(`${owner} must be an existing regular file.`);
    }
    candidate = fs.realpathSync(candidate);
  }
  const resolved = canonicalFile(root, candidate, owner);
  if (resolved !== expected) throw new Error(`${owner} does not match the retained replay artifact.`);
}

function readNativeTraceUserTexts(tracePath: string, owner: string): string[] {
  const texts: string[] = [];
  for (const [lineIndex, line] of fs.readFileSync(tracePath, 'utf-8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${owner} fresh trace line ${lineIndex + 1} is invalid JSON.`);
    }
    if (!isObject(value) || value.entry_type !== 'trace') continue;
    const user = requiredObject(value.user, `${owner} fresh trace line ${lineIndex + 1}.user`);
    texts.push(requiredString(user.text, `${owner} fresh trace line ${lineIndex + 1}.user.text`));
  }
  return texts;
}

function candidateTraceOutputContract(
  candidateName: string,
  prefixes: string[] | undefined,
): ArenaTraceOutputContract | undefined {
  return prefixes
    ? { linePrefixes: [...prefixes], subjectSkillId: candidateName }
    : undefined;
}

function validateTargetProfile(
  value: unknown,
  candidateType: CandidateType,
  candidateName: string,
  owner: string,
  expected: ArenaTargetProfile,
): void {
  const profile = requiredObject(value, `${owner}.target_profile`);
  const loadedSkills = strictStringArray(profile.loaded_skills, `${owner}.target_profile.loaded_skills`);
  const roleLocalSkills = strictStringArray(profile.role_local_skills, `${owner}.target_profile.role_local_skills`);
  strictStringArray(profile.registered_tools, `${owner}.target_profile.registered_tools`);
  strictStringArray(
    profile.provider_visible_tools,
    `${owner}.target_profile.provider_visible_tools`,
  );
  if (profile.surface !== 'pet') {
    throw new Error(`${owner} target profile is not a clean Pet runtime profile.`);
  }
  if (candidateType === 'skill') {
    if (
      profile.active_role_id !== 'base'
      || profile.subject_skill_id !== candidateName
      || !sameStrings(loadedSkills, [candidateName])
      || roleLocalSkills.length !== 0
    ) {
      throw new Error(`${owner} target profile does not prove zero-default Base plus only the passed Skill.`);
    }
  } else if (
    profile.active_role_id !== candidateName
    || profile.subject_skill_id !== undefined
    || !sameStrings(loadedSkills, roleLocalSkills)
  ) {
    throw new Error(`${owner} target profile does not run the passed Role directly.`);
  }
  if (stableJson(profile) !== stableJson(expected)) {
    throw new Error(`${owner} target profile does not exactly match the immutable clean Pet runtime profile.`);
  }
}

function validateManifestProfile(
  root: string,
  manifest: JsonObject,
  profileValue: unknown,
  candidateType: CandidateType,
  candidateName: string,
  fingerprint: string,
): void {
  const profile = requiredObject(profileValue, 'arena_run.target_profile');
  const parsed = requiredObject(manifest.parsed, 'subject_manifest.parsed');
  const skillFiles = strictStringArray(parsed.skill_files, 'subject_manifest.parsed.skill_files');
  const subjectId = requiredString(manifest.subject_id, 'subject_manifest.subject_id');
  if (candidateType === 'skill') {
    if (
      manifest.role !== undefined
      || !sameStrings(skillFiles.map(normalizeRef), [`arena/subjects/${subjectId}/source/SKILL.md`])
    ) {
      throw new Error('Skill subject manifest does not describe exactly its immutable root SKILL.md.');
    }
    return;
  }
  const role = requiredObject(manifest.role, 'subject_manifest.role');
  const localSkills = strictStringArray(role.local_skills, 'subject_manifest.role.local_skills');
  if (
    role.id !== candidateName
    || role.fingerprint !== fingerprint
    || !sameStrings(localSkills, [...localSkills].sort())
    || !sameStrings(strictStringArray(profile.role_local_skills, 'target_profile.role_local_skills'), localSkills)
    || !sameStrings(strictStringArray(profile.loaded_skills, 'target_profile.loaded_skills'), localSkills)
  ) {
    throw new Error('Role subject manifest and clean runtime profile do not match exactly.');
  }
  const parsedLocalSkills = skillFiles.map(fileRef => {
    const skillFile = resolveExistingRef(root, fileRef, 'Role local Skill');
    return SkillParser.parse(skillFile).metadata.name;
  });
  if (!sameStrings(parsedLocalSkills.sort(), [...localSkills].sort())) {
    throw new Error('Role manifest local Skill files do not match its declared local_skills.');
  }
}

function validateArenaReplayPlan(input: {
  root: string;
  arenaRunId: string;
  scorecard: JsonObject;
  arenaRun: JsonObject;
}): ValidatedArenaReplayPlan {
  const runRoot = path.join(input.root, 'arena', 'runs', input.arenaRunId);
  const expectedInspectorCasesPath = canonicalFile(
    input.root,
    path.join(runRoot, 'debug', 'inspector-cases.json'),
    'Arena Inspector cases artifact',
  );
  const expectedInspectorCasesRef = relativeRef(input.root, expectedInspectorCasesPath);
  const debugRefs = requiredObject(input.scorecard.debug_refs, 'scorecard.debug_refs');
  const inspectorCasesRef = requiredString(
    debugRefs.inspector_cases,
    'scorecard.debug_refs.inspector_cases',
  );
  const inspectorCasesPath = resolveCanonicalRawEvidenceRef(
    input.root,
    inspectorCasesRef,
    'Arena Inspector cases artifact',
  );
  if (
    inspectorCasesPath !== expectedInspectorCasesPath
    || inspectorCasesRef !== expectedInspectorCasesRef
  ) {
    throw new Error('Arena Inspector cases ref does not match the canonical retained artifact.');
  }
  const runInspectorRefs = strictStringArray(input.arenaRun.inspector_refs, 'arena_run.inspector_refs');
  if (!sameStrings(runInspectorRefs, [expectedInspectorCasesRef])) {
    throw new Error('Arena run inspector_refs must bind exactly the canonical retained Inspector cases artifact.');
  }

  const inspectorArtifact = readJson(inspectorCasesPath);
  const artifactCaseValues = Array.isArray(inspectorArtifact.cases)
    ? inspectorArtifact.cases
    : invalidArray('Arena Inspector cases artifact.cases');
  const scorecardCaseValues = Array.isArray(input.scorecard.cases)
    ? input.scorecard.cases
    : invalidArray('scorecard.cases');
  const inspectorCases = parseArenaInspectorCases(artifactCaseValues, 'Arena Inspector cases artifact.cases');
  parseArenaInspectorCases(scorecardCaseValues, 'scorecard.cases');
  if (
    inspectorArtifact.version !== 1
    || inspectorArtifact.run_id !== input.arenaRunId
    || inspectorArtifact.inspector_role !== 'inspector-cat'
    || countValue(inspectorArtifact.case_count, 'Arena Inspector cases artifact.case_count') !== inspectorCases.length
  ) {
    throw new Error('Arena Inspector cases artifact does not match the evaluated Arena run.');
  }
  const scorecardTraceRefs = strictStringArray(
    requiredObject(input.scorecard.evidence, 'scorecard.evidence').trace_refs,
    'scorecard.evidence.trace_refs',
  );
  const inspectorTraceRefs = strictStringArray(
    inspectorArtifact.trace_refs,
    'Arena Inspector cases artifact.trace_refs',
  );
  if (!sameStrings(inspectorTraceRefs, scorecardTraceRefs)) {
    throw new Error('Arena Inspector cases trace refs must exactly match the scorecard native traces.');
  }
  const nativeTraceRefSet = new Set(inspectorTraceRefs.map((ref, index) => {
    const tracePath = resolveCanonicalRawEvidenceRef(
      input.root,
      ref,
      `Arena Inspector native trace ${index + 1}`,
    );
    if (path.extname(tracePath) !== '.jsonl') {
      throw new Error('Arena Inspector native trace refs must name JSONL traces.');
    }
    return relativeRef(input.root, tracePath);
  }));
  if (stableJson(artifactCaseValues) !== stableJson(scorecardCaseValues)) {
    throw new Error('Arena scorecard cases must exactly match the retained Inspector cases artifact.');
  }

  const arenaRunnerPath = canonicalFile(
    input.root,
    path.join(runRoot, 'arena-runner.json'),
    'Arena runner artifact',
  );
  const runner = readJson(arenaRunnerPath);
  if (runner.version !== 1 || runner.run_id !== input.arenaRunId) {
    throw new Error('Arena runner artifact does not match the evaluated Arena run.');
  }
  const workerCommand = stringArrayValue(runner.worker_command, 'arena_runner.worker_command');
  const workerMarker = workerCommand.findIndex((value, index) => (
    value === 'arena'
    && workerCommand[index + 1] === 'run'
    && workerCommand[index + 2] === 'worker'
  ));
  if (workerMarker < 0) throw new Error('Arena runner artifact does not contain the canonical worker command.');
  const workerRunId = requiredWorkerOption(workerCommand, '--run-id');
  if (workerRunId !== input.arenaRunId) {
    throw new Error('Arena runner worker command run id does not match the evaluated Arena run.');
  }
  const replayConfig = resolveArenaReplayConfig({
    replayAttempts: optionalCanonicalPositiveWorkerOption(workerCommand, '--replay-attempts'),
    maxReplayCases: optionalCanonicalPositiveWorkerOption(workerCommand, '--max-replay-cases'),
  });
  const profile = requiredObject(input.scorecard.arena_eval_profile, 'scorecard.arena_eval_profile');
  if (
    profile.profile !== 'normal'
    || positiveCountValue(
      profile.replay_attempts_per_case,
      'arena_eval_profile.replay_attempts_per_case',
    ) !== replayConfig.replayAttemptsPerCase
    || positiveCountValue(profile.max_replay_cases, 'arena_eval_profile.max_replay_cases')
      !== replayConfig.maxReplayCases
  ) {
    throw new Error('Arena replay profile config does not match the canonical Arena runner command.');
  }

  const selection = buildReplayTargets(input.root, inspectorCases, replayConfig.maxReplayCases);
  const expectedCaseIds: string[] = [];
  const expectedSourceTraceRefs: string[] = [];
  for (const target of selection.targets) {
    const sourceTraceRef = canonicalReplaySourceRef(input.root, target.tracePath);
    if (!nativeTraceRefSet.has(sourceTraceRef)) {
      throw new Error('Every selected replay source must come from the retained Inspector native trace refs.');
    }
    for (let attempt = 0; attempt < replayConfig.replayAttemptsPerCase; attempt += 1) {
      expectedCaseIds.push(target.caseId);
      expectedSourceTraceRefs.push(sourceTraceRef);
    }
  }
  const expectedPlanned = expectedCaseIds.length;
  if (
    countValue(profile.inspector_case_count, 'arena_eval_profile.inspector_case_count') !== inspectorCases.length
    || countValue(profile.replay_candidate_case_count, 'arena_eval_profile.replay_candidate_case_count')
      !== selection.candidate_count
    || countValue(profile.replay_case_count, 'arena_eval_profile.replay_case_count') !== selection.targets.length
    || countValue(profile.skipped_replay_case_count, 'arena_eval_profile.skipped_replay_case_count')
      !== selection.skipped_count
    || countValue(profile.planned_replay_attempts, 'arena_eval_profile.planned_replay_attempts')
      !== expectedPlanned
  ) {
    throw new Error('Arena replay profile counters do not match deterministic Inspector case selection.');
  }

  const attempts = requiredObject(input.scorecard.replay_attempts, 'scorecard.replay_attempts');
  const planned = countValue(attempts.planned, 'replay_attempts.planned');
  const completed = countValue(attempts.completed, 'replay_attempts.completed');
  const passCount = countValue(attempts.pass_count, 'replay_attempts.pass_count');
  const failCount = countValue(attempts.fail_count, 'replay_attempts.fail_count');
  const blockedCount = countValue(attempts.blocked_count, 'replay_attempts.blocked_count');
  const indexedCaseIds = attempts.case_ids === undefined
    ? []
    : stringArrayValue(attempts.case_ids, 'replay_attempts.case_ids');
  const indexedSourceTraceRefs = attempts.source_trace_refs === undefined
    ? []
    : stringArrayValue(attempts.source_trace_refs, 'replay_attempts.source_trace_refs');
  if (
    planned !== expectedPlanned
    || !sameStrings(indexedCaseIds, expectedCaseIds)
    || !sameStrings(indexedSourceTraceRefs, expectedSourceTraceRefs)
  ) {
    throw new Error('Arena replay attempts do not match deterministic selection from retained Inspector cases.');
  }
  return {
    inspectorCasesPath,
    arenaRunnerPath,
    inspectorCases,
    replayAttempts: {
      planned,
      completed,
      pass_count: passCount,
      fail_count: failCount,
      blocked_count: blockedCount,
    },
  };
}

function validateArenaDecisionSemantics(
  scorecard: JsonObject,
  replayPlan: ValidatedArenaReplayPlan,
): void {
  const decision = decideArenaRun(
    replayPlan.inspectorCases,
    {
      pass_count: replayPlan.replayAttempts.pass_count,
      fail_count: replayPlan.replayAttempts.fail_count,
      blocked_count: replayPlan.replayAttempts.blocked_count,
      case_ids: [],
      source_trace_refs: [],
    },
    requiredObject(
      scorecard.trace_identity_check,
      'scorecard.trace_identity_check',
    ) as unknown as ArenaTraceIdentityCheck,
    requiredObject(
      scorecard.output_contract_check,
      'scorecard.output_contract_check',
    ) as unknown as ArenaOutputContractCheck,
  );
  if (decision !== scorecard.decision) {
    throw new Error(`Arena decision does not match retained Inspector cases and replay outcomes: expected ${decision}.`);
  }
}

function parseArenaInspectorCases(value: unknown[], owner: string): ArenaInspectorCase[] {
  const cases = value.map((raw, index) => {
    const item = requiredObject(raw, `${owner}[${index}]`);
    const evidenceRefs = strictStringArray(item.evidence_refs, `${owner}[${index}].evidence_refs`);
    if (evidenceRefs.length === 0) {
      throw new Error(`${owner}[${index}].evidence_refs must not be empty.`);
    }
    return {
      case_id: requiredString(item.case_id, `${owner}[${index}].case_id`),
      issue_type: requiredString(item.issue_type, `${owner}[${index}].issue_type`),
      severity: enumValue(item.severity, ['high', 'medium', 'low'], `${owner}[${index}].severity`),
      evidence_refs: evidenceRefs,
      suspected_root_cause: requiredString(
        item.suspected_root_cause,
        `${owner}[${index}].suspected_root_cause`,
      ),
      replay_intent: requiredString(item.replay_intent, `${owner}[${index}].replay_intent`),
    };
  });
  if (new Set(cases.map(item => item.case_id)).size !== cases.length) {
    throw new Error(`${owner} must use unique case_id values.`);
  }
  return cases;
}

function requiredWorkerOption(command: string[], option: string): string {
  const values = workerOptionValues(command, option);
  if (values.length !== 1) throw new Error(`Arena runner worker command requires exactly one ${option}.`);
  return values[0];
}

function optionalCanonicalPositiveWorkerOption(command: string[], option: string): number | undefined {
  const values = workerOptionValues(command, option);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0])) {
    throw new Error(`Arena runner worker command ${option} must be one canonical positive integer.`);
  }
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Arena runner worker command ${option} must be one canonical positive integer.`);
  }
  return value;
}

function workerOptionValues(command: string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < command.length; index += 1) {
    if (command[index] !== option) continue;
    if (index + 1 >= command.length || command[index + 1].startsWith('--')) {
      throw new Error(`Arena runner worker command ${option} is missing its value.`);
    }
    values.push(command[index + 1]);
  }
  return values;
}

function invalidArray(name: string): never {
  throw new Error(`${name} must be an array.`);
}

function validateReplayEvidence(
  scorecard: JsonObject,
  arenaRun: JsonObject,
  candidateType: CandidateType,
  candidateName: string,
  candidateOutputContract: string[] | undefined,
  root: string,
): void {
  const scoreAttempts = requiredObject(scorecard.replay_attempts, 'scorecard.replay_attempts');
  const runAttempts = requiredObject(arenaRun.replay_attempts, 'arena_run.replay_attempts');
  if (stableJson(scoreAttempts) !== stableJson(runAttempts)) {
    throw new Error('Arena scorecard and run index replay_attempts must match exactly.');
  }
  const planned = countValue(scoreAttempts.planned, 'replay_attempts.planned');
  const completed = countValue(scoreAttempts.completed, 'replay_attempts.completed');
  const passed = countValue(scoreAttempts.pass_count, 'replay_attempts.pass_count');
  const failed = countValue(scoreAttempts.fail_count, 'replay_attempts.fail_count');
  const blocked = countValue(scoreAttempts.blocked_count, 'replay_attempts.blocked_count');
  const indexedTraceRefs = strictStringArray(scoreAttempts.trace_refs, 'replay_attempts.trace_refs');
  const results = Array.isArray(scorecard.replay_results)
    ? scorecard.replay_results.map((value, index) => requiredObject(value, `replay_results[${index}]`))
    : [];
  if (
    planned !== completed
    || completed !== results.length
    || passed !== completed
    || failed !== 0
    || blocked !== 0
  ) {
    throw new Error('Arena pass requires every planned replay attempt to complete and pass.');
  }
  const indexedCaseIds = results.length > 0
    ? stringArrayValue(scoreAttempts.case_ids, 'replay_attempts.case_ids')
    : scoreAttempts.case_ids === undefined ? [] : stringArrayValue(scoreAttempts.case_ids, 'replay_attempts.case_ids');
  const indexedSourceTraceRefs = results.length > 0
    ? stringArrayValue(scoreAttempts.source_trace_refs, 'replay_attempts.source_trace_refs')
    : scoreAttempts.source_trace_refs === undefined
      ? []
      : stringArrayValue(scoreAttempts.source_trace_refs, 'replay_attempts.source_trace_refs');

  const freshTraceRefs: string[] = [];
  const caseIds: string[] = [];
  const sourceTraceRefs: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.attempt !== index + 1 || result.status !== 'pass') {
      throw new Error(`Replay result ${index + 1} must be the matching successful attempt.`);
    }
    requiredString(result.replay_run_id, `replay_results[${index}].replay_run_id`);
    caseIds.push(requiredString(result.case_id, `replay_results[${index}].case_id`));
    sourceTraceRefs.push(requiredString(result.source_trace_ref, `replay_results[${index}].source_trace_ref`));
    requiredString(result.session_key, `replay_results[${index}].session_key`);
    positiveCountValue(result.turn_count, `replay_results[${index}].turn_count`);
    requiredObject(result.trace_identity_check, `replay_results[${index}].trace_identity_check`);
    validateReplayContractCheck(
      requiredObject(result.output_contract_check, `replay_results[${index}].output_contract_check`),
      candidateType,
      candidateName,
      candidateOutputContract,
      root,
      `replay_results[${index}]`,
    );
    resolveExistingRef(
      root,
      requiredString(result.replay_results_ref, `replay_results[${index}].replay_results_ref`),
      `Replay result ${index + 1}`,
    );
    const traceRef = requiredString(result.fresh_trace_ref, `replay_results[${index}].fresh_trace_ref`);
    resolveCanonicalRawEvidenceRef(root, traceRef, `Replay fresh trace ${index + 1}`);
    freshTraceRefs.push(traceRef);
  }
  if (!sameStrings(freshTraceRefs, indexedTraceRefs)) {
    throw new Error('Replay result fresh traces must exactly match replay_attempts.trace_refs.');
  }
  if (!sameStrings(caseIds, indexedCaseIds) || !sameStrings(sourceTraceRefs, indexedSourceTraceRefs)) {
    throw new Error('Arena scorecard and run index replay attempt case/source bindings must match every result exactly.');
  }
}

function validateReplayContractCheck(
  check: JsonObject,
  candidateType: CandidateType,
  candidateName: string,
  candidateOutputContract: string[] | undefined,
  root: string,
  owner: string,
): void {
  const declared = booleanValue(check.declared, `${owner}.declared`);
  if (declared !== Boolean(candidateOutputContract)) {
    throw new Error(`${owner} output-contract declaration does not match the Candidate.`);
  }
  const expected = countValue(check.expected_turns, `${owner}.expected_turns`);
  const checked = countValue(check.checked_turns, `${owner}.checked_turns`);
  const passed = countValue(check.passed_turns, `${owner}.passed_turns`);
  const violations = countValue(check.violation_count, `${owner}.violation_count`);
  const fully = countValue(check.fully_compliant_sessions, `${owner}.fully_compliant_sessions`);
  const total = countValue(check.total_sessions, `${owner}.total_sessions`);
  if (declared) {
    if (
      check.status !== 'pass'
      || expected <= 0
      || expected !== checked
      || checked !== passed
      || violations !== 0
      || total !== 1
      || fully !== total
    ) {
      throw new Error(`${owner} strict output contract did not fully pass.`);
    }
    const source = SkillParser.parse(resolveExistingRef(
      root,
      requiredString(check.source_ref, `${owner}.source_ref`),
      `${owner} output contract source`,
    ));
    if (
      candidateType !== 'skill'
      || source.metadata.name !== candidateName
      || !sameOptionalStrings(source.metadata.arenaOutputLinePrefixes, candidateOutputContract)
    ) {
      throw new Error(`${owner} output-contract prefixes do not match the Candidate.`);
    }
    return;
  }
  if (
    check.status !== 'not_declared'
    || check.source_ref !== null
    || expected !== 0
    || checked !== 0
    || passed !== 0
    || violations !== 0
    || fully !== 0
    || total !== 1
  ) {
    throw new Error(`${owner} undeclared output contract attestation is invalid.`);
  }
}

function validateIndependentLineages(
  root: string,
  digest: JsonObject,
  evidenceRefs: string[],
): void {
  const observations = Array.isArray(digest.observations)
    ? digest.observations.filter(isObject)
    : [];
  const lineages = new Set<string>();
  for (const ref of evidenceRefs) {
    const matches = observations.filter(observation => observation.trace_ref === ref);
    if (matches.length !== 1) {
      throw new Error(`Inspector evidence must map to exactly one digest observation: ${ref}`);
    }
    const observation = matches[0];
    const [fileRef, traceId, ...extra] = ref.split('#');
    if (!fileRef || !traceId || extra.length > 0) {
      throw new Error(`Inspector evidence must be one trace ref with #trace_id: ${ref}`);
    }
    const tracePath = resolveExistingRef(root, ref, 'Inspector trace evidence');
    const rows = fs.readFileSync(tracePath, 'utf-8')
      .split(/\r?\n/)
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return undefined;
        }
      })
      .filter(isObject)
      .filter(row => String(row.trace_id || row.episode_id || row.turn_id || '') === traceId);
    if (rows.length !== 1) {
      throw new Error(`Inspector trace evidence must resolve to exactly one trace row: ${ref}`);
    }
    const row = rows[0];
    const sessionId = requiredString(row.session_id, `trace ${traceId}.session_id`);
    const lifecycle = Array.isArray(row.events)
      ? [...row.events].reverse().find(event => isObject(event) && event.source === 'subagent')
      : undefined;
    const parentSessionId = lifecycle && typeof lifecycle.parent_session_id === 'string'
      ? lifecycle.parent_session_id.trim()
      : '';
    const rawLineage = parentSessionId || sessionId;
    const digestSessionId = requiredString(observation.session_id, `digest observation ${traceId}.session_id`);
    const digestLineage = typeof observation.parent_session_id === 'string' && observation.parent_session_id.trim()
      ? observation.parent_session_id.trim()
      : digestSessionId;
    if (observation.trace_id !== traceId || digestLineage !== rawLineage) {
      throw new Error(`Digest lineage does not match raw trace evidence: ${ref}`);
    }
    lineages.add(rawLineage);
  }
  if (lineages.size < 2) {
    throw new Error('Inspector evolution evidence must span two independent root session lineages.');
  }
}

function buildPreparedReceipt(input: {
  evidence: ValidatedPromotionEvidence;
  promotionId: string;
  productionRef: string;
  confirmedName: string;
  createdAt: string;
}): PromotionReceipt {
  const { evidence } = input;
  return {
    version: 1,
    promotion_id: input.promotionId,
    state: 'prepared',
    authority: { kind: 'explicit_cli', confirmed_name: input.confirmedName },
    candidate: {
      type: evidence.candidateType,
      name: evidence.candidateName,
      previous_status: 'candidate',
      status: 'active',
    },
    evidence: {
      ...currentReceiptEvidence(evidence),
    },
    production: { ref: input.productionRef },
    created_at: input.createdAt,
  };
}

function readAndValidateReceipt(
  receiptPath: string,
  promotionId: string,
  evidence: ValidatedPromotionEvidence,
  productionRef: string,
): PromotionReceipt {
  if (!inspectPromotionReceiptSlot(receiptPath)) {
    throw new Error('Existing promotion receipt disappeared before it could be validated.');
  }
  try {
    verifyPromotionReceiptRawEvidence({ projectRoot: evidence.root, receiptPath });
  } catch (error) {
    throw new Error(`Existing promotion receipt does not match current raw evidence: ${errorMessage(error)}`);
  }
  const value = readJson(receiptPath) as unknown as PromotionReceipt;
  const expectedEvidence = currentReceiptEvidence(evidence);
  if (
    value.version !== 1
    || value.promotion_id !== promotionId
    || !['prepared', 'promoted'].includes(value.state)
    || value.authority?.kind !== 'explicit_cli'
    || value.authority.confirmed_name !== evidence.candidateName
    || value.candidate?.type !== evidence.candidateType
    || value.candidate.name !== evidence.candidateName
    || value.candidate.previous_status !== 'candidate'
    || value.candidate.status !== 'active'
    || stableJson(value.evidence) !== stableJson(expectedEvidence)
    || value.production?.ref !== productionRef
    || !requiredString(value.created_at, 'receipt.created_at')
    || (value.state === 'prepared' && (value.promoted_at !== undefined || value.production.fingerprint !== undefined))
    || (value.state === 'promoted' && (
      !requiredString(value.promoted_at, 'receipt.promoted_at')
      || !sha256Value(value.production.fingerprint, 'receipt.production.fingerprint')
    ))
  ) {
    throw new Error('Existing promotion receipt does not match this DAG and Arena subject.');
  }
  return value;
}

function currentReceiptEvidence(evidence: ValidatedPromotionEvidence): PromotionReceipt['evidence'] {
  return {
    dag_ref: relativeRef(evidence.root, evidence.dagPath),
    digest_ref: relativeRef(evidence.root, evidence.digestPath),
    inspector_ref: relativeRef(evidence.root, evidence.inspectorPath),
    candidate_decision_ref: relativeRef(evidence.root, evidence.candidateDecisionPath),
    arena_result_ref: relativeRef(evidence.root, evidence.arenaResultPath),
    arena_run_ref: relativeRef(evidence.root, evidence.arenaRunPath),
    scorecard_ref: relativeRef(evidence.root, evidence.scorecardPath),
    subject_manifest_ref: relativeRef(evidence.root, evidence.subjectManifestPath),
    subject_id: evidence.subjectId,
    subject_fingerprint: evidence.subjectFingerprint,
    snapshot_ref: relativeRef(evidence.root, evidence.snapshotRoot),
    payload_fingerprint: evidence.payloadFingerprint,
    sha256: {
      dag_before_link: hashJsonWithoutPromotion(evidence.dag, 'dag'),
      digest: hashFile(evidence.digestPath),
      inspector: hashFile(evidence.inspectorPath),
      candidate_decision: hashFile(evidence.candidateDecisionPath),
      arena_result: hashFile(evidence.arenaResultPath),
      arena_run_before_link: hashJsonWithoutPromotion(evidence.arenaRun, 'arena_run'),
      arena_scorecard: hashFile(evidence.scorecardPath),
      subject_manifest: hashFile(evidence.subjectManifestPath),
    },
    raw_sha256: Object.fromEntries(
      evidence.rawEvidencePaths
        .map(filePath => [relativeRef(evidence.root, filePath), hashFile(filePath)] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function finalizeReceipt(
  receipt: PromotionReceipt,
  productionPath: string,
  promotedAt: string,
): PromotionReceipt {
  return {
    ...receipt,
    state: 'promoted',
    production: {
      ...receipt.production,
      fingerprint: fingerprintArenaDirectory(productionPath),
    },
    promoted_at: promotedAt,
  };
}

function linkPromotionEvidence(
  evidence: ValidatedPromotionEvidence,
  receiptRef: string,
  productionRef: string,
): void {
  validateLinkSlots(evidence, receiptRef, productionRef);
  const terminal = requiredObject(evidence.dag.terminal, 'dag.terminal');
  terminal.promotion_ref = receiptRef;
  const promotion = evidence.arenaRun.promotion === undefined
    ? {}
    : requiredObject(evidence.arenaRun.promotion, 'arena_run.promotion');
  for (const [key, value] of Object.entries({
    status: 'promoted',
    production_ref: productionRef,
    receipt_ref: receiptRef,
  })) {
    promotion[key] = value;
  }
  evidence.arenaRun.promotion = promotion;
  atomicWriteJson(evidence.dagPath, evidence.dag);
  atomicWriteJson(evidence.arenaRunPath, evidence.arenaRun);
}

function validateLinkSlots(
  evidence: ValidatedPromotionEvidence,
  receiptRef: string,
  productionRef: string,
): void {
  const terminal = requiredObject(evidence.dag.terminal, 'dag.terminal');
  if (terminal.promotion_ref !== undefined && terminal.promotion_ref !== receiptRef) {
    throw new Error('DAG already links a different promotion receipt.');
  }
  const promotion = evidence.arenaRun.promotion === undefined
    ? {}
    : requiredObject(evidence.arenaRun.promotion, 'arena_run.promotion');
  const expected: Record<string, string> = {
    status: 'promoted',
    production_ref: productionRef,
    receipt_ref: receiptRef,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (promotion[key] !== undefined && promotion[key] !== value) {
      throw new Error(`Arena run already links different promotion ${key}.`);
    }
  }
}

function validateActiveProduction(
  productionPath: string,
  evidence: ValidatedPromotionEvidence,
): void {
  assertExistingDirectory(evidence.root, productionPath, 'Production capability');
  assertActiveLifecycle(productionPath, evidence.candidateType, evidence.candidateName);
  if (payloadFingerprint(productionPath, evidence.candidateType) !== evidence.payloadFingerprint) {
    throw new Error('Production target does not match the evaluated Arena payload.');
  }
}

function activateOuterLifecycle(packageRoot: string, type: CandidateType): void {
  if (type === 'skill') {
    SkillParser.updateStatus(path.join(packageRoot, 'SKILL.md'), 'active');
    return;
  }
  const rolePath = path.join(packageRoot, 'role.json');
  const role = readJson(rolePath);
  atomicWriteJson(rolePath, { ...role, status: 'active' });
}

function assertCandidateLifecycle(root: string, type: CandidateType, name: string): void {
  if (type === 'skill') {
    const skill = SkillParser.parse(path.join(root, 'SKILL.md'));
    if (skill.metadata.name !== name || skill.metadata.status !== 'candidate') {
      throw new Error('Evaluated Skill snapshot must still be the named Candidate.');
    }
    return;
  }
  const role = readJson(path.join(root, 'role.json'));
  if (role.name !== name || role.status !== 'candidate') {
    throw new Error('Evaluated Role snapshot must still be the named Candidate.');
  }
  const promptFile = safeLeaf(role.promptFile, 'role.promptFile');
  canonicalFile(root, path.join(root, 'prompts', promptFile), 'Role prompt');
}

function assertActiveLifecycle(root: string, type: CandidateType, name: string): void {
  if (type === 'skill') {
    const skill = SkillParser.parse(path.join(root, 'SKILL.md'));
    if (skill.metadata.name !== name || skill.metadata.status !== 'active') {
      throw new Error('Promoted Skill must be the named Active capability.');
    }
    return;
  }
  const role = readJson(path.join(root, 'role.json'));
  if (role.name !== name || role.status !== 'active') {
    throw new Error('Promoted Role must be the named Active capability.');
  }
}

function outputContractPrefixes(root: string, type: CandidateType): string[] | undefined {
  if (type === 'role') return undefined;
  const prefixes = SkillParser.parse(path.join(root, 'SKILL.md')).metadata.arenaOutputLinePrefixes;
  return prefixes ? [...prefixes] : undefined;
}

function sameOptionalStrings(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function payloadFingerprint(root: string, type: CandidateType): string {
  const hash = crypto.createHash('sha256');
  for (const filePath of collectPackageFiles(root)) {
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    hash.update(relative);
    hash.update('\0');
    if (type === 'skill' && relative === 'SKILL.md') {
      const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
      const data = { ...parsed.data } as JsonObject;
      delete data.status;
      hash.update(stableJson({ data, content: parsed.content.trim() }));
    } else if (type === 'role' && relative === 'role.json') {
      const config = readJson(filePath);
      delete config.status;
      hash.update(stableJson(config));
    } else {
      hash.update(fs.readFileSync(filePath));
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

function collectPackageFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const entryPath = path.join(directory, entry.name);
      const stats = fs.lstatSync(entryPath);
      if (stats.isSymbolicLink()) throw new Error(`Capability package contains a symlink: ${entryPath}`);
      if (stats.isDirectory()) visit(entryPath);
      else if (stats.isFile()) files.push(entryPath);
      else throw new Error(`Capability package contains a non-regular entry: ${entryPath}`);
    }
  };
  visit(root);
  return files.sort();
}

function resolveCandidatePackage(
  runRoot: string,
  type: CandidateType,
  name: string,
  declaredPath: string,
): string {
  if (path.isAbsolute(declaredPath)) throw new Error('Candidate path must be run-relative.');
  const expectedRoot = path.join(runRoot, 'candidates', name);
  const requested = path.resolve(runRoot, declaredPath);
  const packageRoot = type === 'skill' && path.basename(requested) === 'SKILL.md'
    ? path.dirname(requested)
    : requested;
  if (packageRoot !== expectedRoot) {
    throw new Error(`Candidate path must resolve to candidates/${name}.`);
  }
  assertExistingDirectory(runRoot, packageRoot, 'Evolution Candidate package');
  return packageRoot;
}

function requireStageOutput(root: string, dag: JsonObject, name: string, expectedPath: string): void {
  const stages = Array.isArray(dag.stages) ? dag.stages : [];
  const stage = stages.find(item => isObject(item) && item.name === name) as JsonObject | undefined;
  if (!stage || stage.status !== 'completed') throw new Error(`DAG stage ${name} must be completed.`);
  requireSamePath(root, requiredString(stage.output_ref, `dag.${name}.output_ref`), expectedPath, `DAG ${name} output`);
}

function requireSamePath(root: string, ref: string, expected: string, owner: string): void {
  const resolved = resolveExistingRef(root, ref, owner);
  if (path.resolve(resolved) !== path.resolve(expected)) {
    throw new Error(`${owner} ref does not match the canonical artifact.`);
  }
}

function requireSameDirectoryPath(root: string, ref: string, expected: string, owner: string): void {
  const fileRef = ref.split('#')[0];
  if (!fileRef) throw new Error(`${owner} ref is empty.`);
  const resolved = path.resolve(root, fileRef);
  assertExistingDirectory(root, resolved, owner);
  if (resolved !== path.resolve(expected)) {
    throw new Error(`${owner} ref does not match the canonical artifact.`);
  }
}

function canonicalFile(root: string, filePath: string, owner: string): string {
  const resolved = path.resolve(filePath);
  assertInside(root, resolved, owner);
  if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(resolved).isFile()) {
    throw new Error(`${owner} must be an existing regular file: ${relativeRef(root, resolved)}`);
  }
  assertInside(fs.realpathSync(root), fs.realpathSync(resolved), owner);
  return resolved;
}

function resolveExistingRef(root: string, ref: string, owner: string): string {
  const fileRef = ref.split('#')[0];
  if (!fileRef) throw new Error(`${owner} ref is empty.`);
  return canonicalFile(root, path.resolve(root, fileRef), owner);
}

function resolveCanonicalRawEvidenceRef(root: string, ref: string, owner: string): string {
  if (path.isAbsolute(ref) || ref.includes('#') || ref.includes('\\')) {
    throw new Error(`${owner} must use one canonical project-relative file ref.`);
  }
  const resolved = canonicalFile(root, path.resolve(root, ref), owner);
  if (relativeRef(root, resolved) !== ref) {
    throw new Error(`${owner} ref is not canonical: ${ref}`);
  }
  return resolved;
}

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map(value => path.resolve(value)))).sort();
}

function assertExistingDirectory(root: string, directory: string, owner: string): void {
  const resolved = path.resolve(directory);
  assertInside(root, resolved, owner);
  if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${owner} must be an existing directory: ${relativeRef(root, resolved)}`);
  }
  assertInside(fs.realpathSync(root), fs.realpathSync(resolved), owner);
}

function ensureOwnedDirectory(root: string, directory: string, owner: string): void {
  const resolved = path.resolve(directory);
  assertInside(root, resolved, owner);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  assertExistingDirectory(root, resolved, owner);
}

function assertInside(root: string, candidate: string, owner: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${owner} escapes the project root.`);
  }
}

function relativeRef(root: string, filePath: string): string {
  return path.relative(root, path.resolve(filePath)).replace(/\\/g, '/');
}

function normalizeRef(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function expectedReviewMode(type: CandidateType): 'base_skill' | 'role' {
  return type === 'skill' ? 'base_skill' : 'role';
}

function promotionResult(
  status: EvolutionPromotionResult['status'],
  receipt: PromotionReceipt,
  evidence: ValidatedPromotionEvidence,
  productionRef: string,
  receiptRef: string,
): EvolutionPromotionResult {
  return {
    status,
    promotion_id: receipt.promotion_id,
    candidate_type: evidence.candidateType,
    candidate_name: evidence.candidateName,
    subject_id: evidence.subjectId,
    subject_fingerprint: evidence.subjectFingerprint,
    production_ref: productionRef,
    receipt_ref: receiptRef,
  };
}

function withPromotionLock<T>(root: string, action: () => T): T {
  const lockPath = path.join(root, 'output', 'evolution', '.promote.lock');
  assertExistingDirectory(root, path.dirname(lockPath), 'Promotion lock root');
  let descriptor: number | undefined;
  try {
    descriptor = acquirePromotionLock(lockPath);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    return action();
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
      try {
        const lock = readJson(lockPath);
        if (lock.pid === process.pid) fs.unlinkSync(lockPath);
      } catch {
        // Never remove a lock that no longer proves this process owns it.
      }
    }
  }
}

function acquirePromotionLock(lockPath: string): number {
  try {
    return fs.openSync(lockPath, 'wx');
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    let pid = 0;
    try {
      pid = Number(readJson(lockPath).pid);
    } catch {
      throw new Error('Evolution promotion lock exists and is unreadable.');
    }
    if (Number.isInteger(pid) && pid > 0 && !processAlive(pid)) {
      fs.unlinkSync(lockPath);
      return fs.openSync(lockPath, 'wx');
    }
    throw new Error(`Evolution promotion is already running (pid=${pid || 'unknown'}).`);
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function inspectPromotionReceiptSlot(receiptPath: string): boolean {
  try {
    if (fs.lstatSync(receiptPath).isSymbolicLink()) {
      throw new Error('Promotion receipt cannot be a symlink.');
    }
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function atomicWritePromotionReceipt(receiptPath: string, value: unknown): void {
  inspectPromotionReceiptSlot(receiptPath);
  atomicWriteJson(receiptPath, value);
}

function readJson(filePath: string): JsonObject {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  if (!isObject(value)) throw new Error(`Expected JSON object: ${filePath}`);
  return value;
}

function readJsonArray(filePath: string, owner: string): unknown[] {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  if (!Array.isArray(value)) throw new Error(`${owner} must be a JSON array.`);
  return value;
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashJsonWithoutPromotion(value: JsonObject, type: 'dag' | 'arena_run'): string {
  const clone = JSON.parse(JSON.stringify(value)) as JsonObject;
  if (type === 'dag') {
    const terminal = isObject(clone.terminal) ? clone.terminal : {};
    delete terminal.promotion_ref;
  } else {
    const promotion = isObject(clone.promotion) ? clone.promotion : {};
    delete promotion.status;
    delete promotion.production_ref;
    delete promotion.receipt_ref;
    clone.promotion = promotion;
  }
  return crypto.createHash('sha256').update(stableJson(clone)).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function requiredObject(value: unknown, name: string): JsonObject {
  if (!isObject(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function safeName(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!/^[a-z0-9_-]+$/.test(result)) throw new Error(`${name} must be a safe capability name.`);
  return result;
}

function safeRunId(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!/^[a-zA-Z0-9._-]+$/.test(result)) throw new Error(`${name} must be a safe identifier.`);
  return result;
}

function sha256Value(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${name} must be a SHA-256 fingerprint.`);
  return result;
}

function safeLeaf(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (path.isAbsolute(result) || result.includes('/') || result.includes('\\') || result.includes('..')) {
    throw new Error(`${name} must be one safe file name.`);
  }
  return result;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean.`);
  return value;
}

function countValue(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${name} must be a non-negative integer.`);
  return Number(value);
}

function positiveCountValue(value: unknown, name: string): number {
  const result = countValue(value, name);
  if (result <= 0) throw new Error(`${name} must be a positive integer.`);
  return result;
}

function uniqueStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${name} must be a string array.`);
  }
  return Array.from(new Set(value.map(item => String(item).trim())));
}

function strictStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${name} must be a string array.`);
  }
  const result = value.map(item => String(item).trim());
  if (new Set(result).size !== result.length) throw new Error(`${name} must not contain duplicates.`);
  return result;
}

function stringArrayValue(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be a string array.`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`));
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(item => right.includes(item));
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Promotion date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid promotion date: ${value}`);
  }
}
