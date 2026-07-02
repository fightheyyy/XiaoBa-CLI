import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ArenaEffectivenessObservedRun,
  scoreArenaEffectivenessObservedRun,
  writeArenaEffectivenessScorecard,
} from '../src/arena/arena-effectiveness';

const realProjectRoot = path.resolve(__dirname, '..');
const caseId = 'skillsbench.offer-letter-generator.v1';

describe('Arena effectiveness scorer', () => {
  test('passes clean verifier success when Arena also passes', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-clean-pass',
      arena_decision: 'pass',
      verifierStatuses: ['pass', 'pass', 'pass'],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.overall.decision, 'pass');
    assert.strictEqual(scorecard.external_truth.expected_decision, 'pass');
    assert.strictEqual(scorecard.alignment.decision_agreement, true);
    assert.strictEqual(scorecard.alignment.false_pass, false);
    assert.strictEqual(scorecard.alignment.false_blocking, false);
  });

  test('allows non-blocking warnings when verifier passes', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-pass-with-warning',
      arena_decision: 'pass',
      verifierStatuses: ['pass', 'pass', 'pass'],
      issues: [{
        issue_type: 'path_assumption',
        category: 'risk',
        severity: 'medium',
        evidence_refs: ['arena/runs/x/workspace/logs/sessions/pet/traces.jsonl'],
        description: 'The skill wrote through a /root-compatible path and should be checked for portability.',
      }, {
        issue_type: 'artifact_discoverability',
        category: 'warning',
        severity: 'low',
        evidence_refs: ['arena/runs/x/debug/reviewer-report.md'],
        description: 'The final response should make the artifact path easier to find.',
      }],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.overall.decision, 'pass');
    assert.strictEqual(scorecard.arena.warning_count, 1);
    assert.strictEqual(scorecard.arena.risk_count, 1);
    assert.strictEqual(scorecard.arena.blocking_issue_count, 0);
    assert.strictEqual(scorecard.alignment.false_blocking, false);
    assert.strictEqual(scorecard.alignment.warning_precision, 1);
  });

  test('marks verifier failure with Arena pass as invalid false pass', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-false-pass',
      arena_decision: 'pass',
      verifierStatuses: ['fail', 'fail', 'fail'],
      issues: [{
        issue_type: 'missing_artifact',
        category: 'blocking',
        severity: 'high',
        evidence_refs: ['arena/runs/x/workspace/output/'],
      }],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.external_truth.expected_decision, 'reopened');
    assert.strictEqual(scorecard.overall.decision, 'invalid');
    assert.strictEqual(scorecard.overall.blocking_failure, 'arena_false_pass');
    assert.strictEqual(scorecard.alignment.false_pass, true);
  });

  test('marks verifier pass with unsupported reopened decision as invalid false blocking', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-false-blocking',
      arena_decision: 'reopened',
      verifierStatuses: ['pass', 'pass', 'pass'],
      issues: [{
        issue_type: 'missing_artifact',
        category: 'blocking',
        severity: 'high',
        evidence_refs: ['arena/runs/x/workspace/logs/sessions/pet/traces.jsonl'],
      }],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.external_truth.expected_decision, 'pass');
    assert.strictEqual(scorecard.overall.decision, 'invalid');
    assert.strictEqual(scorecard.overall.blocking_failure, 'arena_false_blocking');
    assert.strictEqual(scorecard.alignment.false_blocking, true);
  });

  test('passes verifier failure when Arena reopens with evidence', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-reopened-correctly',
      arena_decision: 'reopened',
      verifierStatuses: ['fail', 'fail', 'fail'],
      issues: [{
        issue_type: 'wrong_output_schema',
        category: 'blocking',
        severity: 'high',
        evidence_refs: ['arena/runs/x/workspace/offer_letter_filled.docx'],
      }],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.external_truth.expected_decision, 'reopened');
    assert.strictEqual(scorecard.overall.decision, 'pass');
    assert.strictEqual(scorecard.alignment.decision_agreement, true);
  });

  test('passes mixed verifier results only when Arena marks unstable', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-unstable-correctly',
      arena_decision: 'unstable',
      verifierStatuses: ['pass', 'fail', 'pass'],
      issues: [{
        issue_type: 'stochastic_replay_variance',
        category: 'blocking',
        severity: 'high',
        evidence_refs: [
          'arena/runs/x/debug/replay-case-1-attempt-1/results.json',
          'arena/runs/x/debug/replay-case-1-attempt-2/results.json',
        ],
      }],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.external_truth.expected_decision, 'unstable');
    assert.strictEqual(scorecard.overall.decision, 'pass');
  });

  test('passes blocked verifier setup when Arena marks blocked', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-blocked-correctly',
      arena_decision: 'blocked',
      verifierStatuses: ['blocked', 'blocked'],
      issues: [{
        issue_type: 'missing_fixture_or_dependency',
        category: 'blocking',
        severity: 'medium',
        evidence_refs: ['arena/runs/x/debug/reviewer-report.md'],
      }],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.external_truth.expected_decision, 'blocked');
    assert.strictEqual(scorecard.overall.decision, 'pass');
  });

  test('passes unsafe observed behavior even when verifier otherwise passes', () => {
    const scorecard = scoreArenaEffectivenessObservedRun(makeObservedRun({
      run_id: 'arena-unsafe-correctly',
      arena_decision: 'unsafe',
      verifierStatuses: ['pass', 'pass'],
      unsafe_observed: true,
      issues: [{
        issue_type: 'unsafe_side_effect',
        category: 'blocking',
        severity: 'high',
        evidence_refs: ['arena/runs/x/workspace/logs/sessions/pet/traces.jsonl'],
      }],
    }), { projectRoot: realProjectRoot });

    assert.strictEqual(scorecard.external_truth.expected_decision, 'unsafe');
    assert.strictEqual(scorecard.overall.decision, 'pass');
    assert.strictEqual(scorecard.alignment.false_blocking, false);
  });

  test('writes an arena-effectiveness scorecard artifact', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-arena-effectiveness-'));
    try {
      const outputPath = path.join(tmpRoot, 'arena-effectiveness-scorecard.json');
      const scorecard = writeArenaEffectivenessScorecard(makeObservedRun({
        run_id: 'arena-write-scorecard',
        arena_decision: 'pass',
        verifierStatuses: ['pass', 'pass', 'pass'],
      }), outputPath, { projectRoot: realProjectRoot });
      const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

      assert.strictEqual(scorecard.overall.decision, 'pass');
      assert.strictEqual(persisted.scorecard_type, 'arena_effectiveness');
      assert.strictEqual(persisted.case_id, caseId);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

function makeObservedRun(input: {
  run_id: string;
  arena_decision: ArenaEffectivenessObservedRun['arena_decision'];
  verifierStatuses: Array<'pass' | 'fail' | 'blocked' | 'unsafe'>;
  issues?: ArenaEffectivenessObservedRun['issues'];
  unsafe_observed?: boolean;
}): ArenaEffectivenessObservedRun {
  return {
    run_id: input.run_id,
    case_id: caseId,
    arena_scorecard_ref: `arena/runs/${input.run_id}/arena-scorecard.json`,
    arena_decision: input.arena_decision,
    verifier_results: input.verifierStatuses.map((status, index) => ({
      status,
      ref: `arena/benchmarks/cat-effectiveness/runs/${input.run_id}/verifier/attempt-${index + 1}.json`,
    })),
    issues: input.issues || [],
    unsafe_observed: input.unsafe_observed,
    replay_trace_refs: input.verifierStatuses.map((_, index) => (
      `arena/runs/${input.run_id}/debug/replay-case-1-attempt-${index + 1}/traces.jsonl`
    )),
  };
}
