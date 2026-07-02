import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CatEffectivenessObservedRun,
  scoreCatEffectivenessObservedRun,
  writeCatEffectivenessScorecard,
} from '../src/arena/cat-effectiveness';

const realProjectRoot = path.resolve(__dirname, '..');
const caseId = 'skillsbench.offer-letter-generator.v1';

describe('Arena Cat effectiveness scorer', () => {
  test('passes a gold case when all three Cats meet the external-label contract', () => {
    const scorecard = scoreCatEffectivenessObservedRun(makeHealthyObservedRun(), {
      projectRoot: realProjectRoot,
    });

    assert.strictEqual(scorecard.scorecard_type, 'cat_effectiveness');
    assert.strictEqual(scorecard.overall.decision, 'pass');
    assert.ok(scorecard.overall.score >= 85);
    assert.ok(scorecard.usercat.score >= 70);
    assert.strictEqual(scorecard.usercat.oracle_leakage, false);
    assert.deepStrictEqual(scorecard.usercat.missing_behaviors, []);
    assert.ok(scorecard.inspector.score >= 75);
    assert.strictEqual(scorecard.inspector.false_positive_count, 0);
    assert.ok(scorecard.reviewer.score >= 85);
    assert.strictEqual(scorecard.reviewer.expected_decision, 'pass');
    assert.strictEqual(scorecard.reviewer.false_pass, false);
    assert.strictEqual(scorecard.reviewer.replay_hygiene, true);
  });

  test('fails InspectorCat independently when a verifier failure has no extracted case', () => {
    const observed = makeHealthyObservedRun();
    observed.run_id = 'offer-letter-inspector-miss';
    observed.inspector.clean_success_observed = false;
    observed.inspector.observed_cases = [];
    observed.reviewer.decision = 'reopened';
    observed.reviewer.verifier_results = [
      { status: 'fail', ref: 'verifier/attempt-1.json' },
      { status: 'fail', ref: 'verifier/attempt-2.json' },
      { status: 'fail', ref: 'verifier/attempt-3.json' },
    ];

    const scorecard = scoreCatEffectivenessObservedRun(observed, {
      projectRoot: realProjectRoot,
    });

    assert.strictEqual(scorecard.overall.decision, 'needs_tuning');
    assert.ok(scorecard.inspector.score < 75);
    assert.deepStrictEqual(scorecard.inspector.matched_issue_types, []);
    assert.ok(scorecard.inspector.failed_dimensions.includes('case_recall'));
    assert.strictEqual(scorecard.reviewer.expected_decision, 'reopened');
    assert.strictEqual(scorecard.reviewer.false_pass, false);
  });

  test('marks ReviewerCat false pass as an invalid Cat loop', () => {
    const observed = makeHealthyObservedRun();
    observed.run_id = 'offer-letter-reviewer-false-pass';
    observed.inspector.clean_success_observed = false;
    observed.inspector.observed_cases = [{
      case_id: 'missing-artifact-1',
      issue_type: 'missing_artifact',
      severity: 'high',
      evidence_refs: ['arena/runs/x/workspace/logs/sessions/pet/traces.jsonl', 'arena/runs/x/workspace/output/'],
      replay_intent: 'Rerun the low-information offer-letter request and check artifact creation.',
    }];
    observed.reviewer.decision = 'pass';
    observed.reviewer.verifier_results = [
      { status: 'fail', ref: 'verifier/attempt-1.json' },
      { status: 'fail', ref: 'verifier/attempt-2.json' },
      { status: 'fail', ref: 'verifier/attempt-3.json' },
    ];

    const scorecard = scoreCatEffectivenessObservedRun(observed, {
      projectRoot: realProjectRoot,
    });

    assert.strictEqual(scorecard.overall.decision, 'invalid');
    assert.strictEqual(scorecard.overall.blocking_failure, 'reviewer_false_pass');
    assert.strictEqual(scorecard.reviewer.false_pass, true);
    assert.ok(scorecard.reviewer.failed_dimensions.includes('false_pass_guard'));
  });

  test('marks UserCat oracle leakage as invalid even when the subject appears to pass', () => {
    const observed = makeHealthyObservedRun();
    observed.run_id = 'offer-letter-usercat-leak';
    observed.usercat.transcript_text = [
      '帮我填一下 offer letter。',
      '记得检查 nested tables 和 headers/footers。',
    ].join('\n');

    const scorecard = scoreCatEffectivenessObservedRun(observed, {
      projectRoot: realProjectRoot,
    });

    assert.strictEqual(scorecard.overall.decision, 'invalid');
    assert.strictEqual(scorecard.overall.blocking_failure, 'usercat_oracle_leakage');
    assert.strictEqual(scorecard.usercat.oracle_leakage, true);
    assert.ok(scorecard.usercat.leaked_terms.includes('nested tables'));
  });

  test('writes a cat-effectiveness scorecard artifact', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-cat-scorecard-'));
    try {
      const outputPath = path.join(tmpRoot, 'cat-effectiveness-scorecard.json');
      const scorecard = writeCatEffectivenessScorecard(makeHealthyObservedRun(), outputPath, {
        projectRoot: realProjectRoot,
      });
      const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

      assert.strictEqual(scorecard.overall.decision, 'pass');
      assert.strictEqual(persisted.scorecard_type, 'cat_effectiveness');
      assert.strictEqual(persisted.case_id, caseId);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

function makeHealthyObservedRun(): CatEffectivenessObservedRun {
  return {
    run_id: 'offer-letter-healthy',
    case_id: caseId,
    arena_run_ref: 'arena/runs/offer-letter-healthy/arena-run.json',
    usercat: {
      turn_count: 3,
      observed_behaviors: [
        'low_info_opening',
        'artifact_path_followup',
        'placeholder_completion_check',
        'adaptive_followup',
      ],
      transcript_text: [
        '帮我把这个 offer letter 模板填好。',
        '你说完成了，那成品 DOCX 在哪里？',
        '里面那些占位符和条件标记都去掉了吗？',
      ].join('\n'),
      evidence_refs: ['arena/runs/offer-letter-healthy/workspace/data/user-cat/traces/trace.jsonl'],
    },
    inspector: {
      clean_success_observed: true,
      observed_cases: [],
      evidence_refs: ['arena/runs/offer-letter-healthy/debug/inspector-cases.json'],
    },
    reviewer: {
      decision: 'pass',
      verifier_results: [
        { status: 'pass', ref: 'verifier/attempt-1.json' },
        { status: 'pass', ref: 'verifier/attempt-2.json' },
        { status: 'pass', ref: 'verifier/attempt-3.json' },
      ],
      fresh_trace_refs: [
        'arena/runs/offer-letter-healthy/debug/replay-case-1-attempt-1/traces.jsonl',
        'arena/runs/offer-letter-healthy/debug/replay-case-1-attempt-2/traces.jsonl',
        'arena/runs/offer-letter-healthy/debug/replay-case-1-attempt-3/traces.jsonl',
      ],
      artifact_refs: ['arena/runs/offer-letter-healthy/workspace/offer_letter_filled.docx'],
      original_failure_refs: ['arena/runs/offer-letter-healthy/workspace/logs/sessions/pet/traces.jsonl'],
      evidence_refs: ['arena/runs/offer-letter-healthy/debug/reviewer-scorecard.json'],
      replay_attempts: {
        planned: 3,
        completed: 3,
        trace_refs: [
          'arena/runs/offer-letter-healthy/debug/replay-case-1-attempt-1/traces.jsonl',
          'arena/runs/offer-letter-healthy/debug/replay-case-1-attempt-2/traces.jsonl',
          'arena/runs/offer-letter-healthy/debug/replay-case-1-attempt-3/traces.jsonl',
        ],
      },
    },
  };
}
