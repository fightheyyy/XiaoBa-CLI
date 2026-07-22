import * as fs from 'fs';
import * as path from 'path';
import { runIsolatedTraceReplay } from '../replay/isolated-trace-replay';
import { traceReplayReportPassed } from '../replay/trace-replay-runner';
import {
  EvolutionPatchCandidateManifest,
  EvolutionPatchWorkspace,
  relocateReplayArtifacts,
} from '../roles/evolution-cat/evolution-patch-workspace';
import type { ArenaDecision } from './types';
import { attestArenaTraceRuns, summarizeArenaTraceIdentity } from './trace-attestation';

const READ_ONLY_TOOLS = new Set(['read_file', 'grep', 'glob']);

export interface PatchRegressionResult {
  run_id: string;
  decision: ArenaDecision;
  scorecard_ref: string;
}

interface PatchRegressionAttempt {
  attempt: number;
  status: 'pass' | 'fail' | 'blocked' | 'unsafe';
  run_id?: string;
  session_key?: string;
  replayed_turns?: number;
  manifest_ref?: string;
  replay_results_ref?: string;
  comparison_ref?: string;
  fresh_trace_ref?: string;
  unsafe_tools?: string[];
  notes?: string[];
  error?: string;
}

export async function runPatchRegression(input: {
  projectRoot: string;
  targetDate: string;
  workspace: EvolutionPatchWorkspace;
  candidate: EvolutionPatchCandidateManifest;
  reviewerEvidenceRefs: string[];
  replayAttempts?: number;
  timeoutMs?: number;
  now?: () => Date;
}): Promise<PatchRegressionResult> {
  const attempts = input.replayAttempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 2) {
    throw new Error('Arena repair regression requires at least two replay attempts');
  }
  const timeoutMs = input.timeoutMs ?? 120_000;
  const now = input.now || (() => new Date());
  const workspaceReplayRoot = path.join(input.workspace.workspaceRunRoot, 'reviewer-replay');
  const sourceTracePath = path.join(workspaceReplayRoot, 'source-trace.jsonl');
  const reviewerManifestPath = path.join(workspaceReplayRoot, 'manifest.json');
  if (!fs.existsSync(sourceTracePath) || !fs.existsSync(reviewerManifestPath)) {
    throw new Error('Arena repair regression requires the Reviewer frozen replay artifacts');
  }
  const reviewerManifest = JSON.parse(fs.readFileSync(reviewerManifestPath, 'utf-8')) as {
    session_key?: string;
    replayed_turns?: number;
  };
  const maxTurns = Number(reviewerManifest.replayed_turns || 0);
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
    throw new Error('Reviewer replay manifest does not contain a valid replayed_turns count');
  }
  const targetRole = targetRoleFromSessionKey(reviewerManifest.session_key);
  const runId = `repair-regression-${input.targetDate}-${input.candidate.patch_sha256.slice(0, 12)}`;
  const durableRoot = path.join(input.workspace.runRoot, 'arena-regression');
  resetOwnedDirectory(input.workspace.runRoot, durableRoot);

  const attemptResults: PatchRegressionAttempt[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const workspaceOut = path.join(input.workspace.workspaceRunRoot, 'arena-regression', `attempt-${attempt}`);
    const durableOut = path.join(durableRoot, `attempt-${attempt}`);
    try {
      const report = runIsolatedTraceReplay({
        codeRoot: input.workspace.workspaceRoot,
        tracePath: sourceTracePath,
        outDir: workspaceOut,
        parentSessionId: `evolution:dag:${input.targetDate}`,
        ...(targetRole ? { targetRole } : {}),
        sessionKey: `pet:xiaoba:role-${targetRole || 'base'}:${runId}-attempt-${attempt}`,
        source: 'evolution-arena-repair-regression',
        maxTurns,
        timeoutMs,
      });
      const unsafeTools = [...new Set(
        report.results.flatMap(item => item.tools).filter(tool => !READ_ONLY_TOOLS.has(tool)),
      )];
      const durableReport = relocateReplayArtifacts({
        workspace: input.workspace,
        sourceDirectory: workspaceOut,
        destinationDirectory: durableOut,
      });
      const status = unsafeTools.length > 0
        ? 'unsafe' as const
        : traceReplayReportPassed(report) ? 'pass' as const : 'fail' as const;
      attemptResults.push({
        attempt,
        status,
        run_id: durableReport.run_id,
        session_key: durableReport.session_key,
        replayed_turns: durableReport.replayed_turns,
        manifest_ref: relativeRef(durableReport.artifacts.manifest_path, input.projectRoot),
        replay_results_ref: relativeRef(durableReport.artifacts.replay_results_path, input.projectRoot),
        comparison_ref: relativeRef(durableReport.artifacts.comparison_path, input.projectRoot),
        ...(durableReport.fresh_trace_path && {
          fresh_trace_ref: relativeRef(durableReport.fresh_trace_path, input.projectRoot),
        }),
        unsafe_tools: unsafeTools,
        notes: durableReport.comparison.notes,
      });
    } catch (error: any) {
      attemptResults.push({
        attempt,
        status: 'blocked',
        error: String(error?.message || error),
      });
    }
  }

  const identitySessions = attestArenaTraceRuns({
    projectRoot: input.projectRoot,
    claims: attemptResults.map(item => ({
      runId: item.run_id || `${runId}-attempt-${item.attempt}`,
      sessionKey: item.session_key,
      expectedTurns: item.replayed_turns || 0,
      ...(!item.fresh_trace_ref && { blockedReason: item.error || 'repair regression retained no fresh trace' }),
    })),
    tracePaths: attemptResults
      .map(item => item.fresh_trace_ref ? path.resolve(input.projectRoot, item.fresh_trace_ref) : '')
      .filter(Boolean),
  });
  for (const [index, identity] of identitySessions.entries()) {
    if (identity.identityStatus === 'blocked') {
      attemptResults[index].status = 'blocked';
      attemptResults[index].notes = [
        ...(attemptResults[index].notes || []),
        ...identity.identityBlockedReasons,
      ];
    }
  }
  const traceIdentityCheck = summarizeArenaTraceIdentity(identitySessions);
  const decision = decidePatchRegression(attemptResults.map(item => item.status));
  const scorecardPath = path.join(durableRoot, 'arena-scorecard.json');
  writeJson(scorecardPath, {
    version: 1,
    scorecard_type: 'arena_patch_regression',
    review_mode: 'repair_regression',
    run_id: runId,
    generated_at: now().toISOString(),
    decision,
    subject: {
      type: 'patch',
      candidate_id: input.candidate.candidate_id,
      base_commit: input.candidate.base_commit,
      patch_sha256: input.candidate.patch_sha256,
      candidate_ref: relativeRef(path.join(input.workspace.candidateRoot, 'manifest.json'), input.projectRoot),
      changed_files: input.candidate.changed_files,
    },
    frozen_case: {
      reviewer_evidence_refs: input.reviewerEvidenceRefs,
      source_trace_ref: relativeRef(
        path.join(input.workspace.runRoot, 'reviewer-replay', 'source-trace.jsonl'),
        input.projectRoot,
      ),
      target_role: targetRole || 'base',
      turns: maxTurns,
    },
    replay_attempts: {
      planned: attempts,
      completed: attemptResults.length,
      pass_count: attemptResults.filter(item => item.status === 'pass').length,
      fail_count: attemptResults.filter(item => item.status === 'fail').length,
      blocked_count: attemptResults.filter(item => item.status === 'blocked').length,
      unsafe_count: attemptResults.filter(item => item.status === 'unsafe').length,
    },
    trace_identity_check: traceIdentityCheck,
    attempts: attemptResults,
    summary: `repair regression ${decision}: ${attemptResults.map(item => item.status).join(', ')}`,
  });
  return {
    run_id: runId,
    decision,
    scorecard_ref: relativeRef(scorecardPath, input.projectRoot),
  };
}

export function decidePatchRegression(statuses: Array<'pass' | 'fail' | 'blocked' | 'unsafe'>): ArenaDecision {
  if (statuses.length === 0) return 'blocked';
  if (statuses.includes('unsafe')) return 'unsafe';
  const pass = statuses.filter(item => item === 'pass').length;
  const fail = statuses.filter(item => item === 'fail').length;
  const blocked = statuses.filter(item => item === 'blocked').length;
  if (pass === statuses.length) return 'pass';
  if (pass > 0) return 'unstable';
  if (fail > 0) return 'reopened';
  if (blocked > 0) return 'blocked';
  return 'blocked';
}

function targetRoleFromSessionKey(value: string | undefined): string | undefined {
  const role = /(?:^|:)role-([^:]+)/.exec(String(value || ''))?.[1];
  return role && role !== 'base' ? role : undefined;
}

function resetOwnedDirectory(root: string, directory: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(directory);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Arena repair regression output escapes its DAG run root');
  }
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function relativeRef(target: string, root: string): string {
  return path.relative(root, target).replace(/\\/g, '/');
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}
