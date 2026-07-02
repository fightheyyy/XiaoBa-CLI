import { afterEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runSkillsBenchCitationCheckVerifier,
  runSkillsBenchOfferLetterVerifier,
  runSkillsBenchVerifier,
  writeSkillsBenchLiveProofScorecards,
} from '../src/arena/skillsbench-live-proof';

describe('SkillsBench Arena live proof adapters', () => {
  let testRoot = '';

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('normalizes a missing offer-letter artifact as verifier fail', () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-skillsbench-proof-'));
    const runId = 'missing-output';
    const workspaceRoot = path.join(testRoot, 'arena', 'runs', runId, 'workspace');
    writeJson(path.join(testRoot, 'arena', 'runs', runId, 'clean-runtime.json'), {
      roots: { workspace_root: workspaceRoot },
    });
    writeJson(path.join(workspaceRoot, 'employee_data.json'), { CANDIDATE_FULL_NAME: 'Sarah Chen' });
    writeText(path.join(workspaceRoot, 'offer_letter_template.docx'), 'template');

    const verifier = runSkillsBenchOfferLetterVerifier({
      projectRoot: testRoot,
      runId,
      caseId: 'skillsbench.offer-letter-generator.v1',
    });

    assert.strictEqual(verifier.status, 'fail');
    assert.match(verifier.message, /Output file not found/);
    assert.ok(fs.existsSync(path.join(
      testRoot,
      'arena',
      'benchmarks',
      'cat-effectiveness',
      'runs',
      runId,
      'verifier',
      'verifier-results.json',
    )));
  });

  test('normalizes a missing citation answer artifact as verifier fail', () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-skillsbench-proof-'));
    const runId = 'missing-citation-output';
    const workspaceRoot = path.join(testRoot, 'arena', 'runs', runId, 'workspace');
    writeJson(path.join(testRoot, 'arena', 'runs', runId, 'clean-runtime.json'), {
      roots: { workspace_root: workspaceRoot },
    });
    writeText(path.join(workspaceRoot, 'test.bib'), '@article{demo,title={Demo}}');

    const verifier = runSkillsBenchCitationCheckVerifier({
      projectRoot: testRoot,
      runId,
      caseId: 'skillsbench.citation-check.v1',
    });

    assert.strictEqual(verifier.status, 'fail');
    assert.match(verifier.message, /Output file not found/);
    assert.ok(fs.existsSync(path.join(
      testRoot,
      'arena',
      'benchmarks',
      'cat-effectiveness',
      'runs',
      runId,
      'verifier',
      'verifier-results.json',
    )));
  });

  test('normalizes a missing generic SkillsBench artifact as verifier fail', () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-skillsbench-proof-'));
    const runId = 'missing-dialogue-output';
    const workspaceRoot = path.join(testRoot, 'arena', 'runs', runId, 'workspace');
    writeJson(path.join(testRoot, 'arena', 'runs', runId, 'clean-runtime.json'), {
      roots: { workspace_root: workspaceRoot },
    });
    writeText(path.join(workspaceRoot, 'script.txt'), '[Start]\nNarrator: hi -> End\n');

    const verifier = runSkillsBenchVerifier({
      projectRoot: testRoot,
      runId,
      caseId: 'skillsbench.dialogue-parser.v1',
    });

    assert.strictEqual(verifier.status, 'fail');
    assert.match(verifier.message, /Output file\(s\) not found/);
    assert.ok(fs.existsSync(path.join(
      testRoot,
      'arena',
      'benchmarks',
      'cat-effectiveness',
      'runs',
      runId,
      'verifier',
      'verifier-results.json',
    )));
  });

  test('writes Cat and Arena effectiveness scorecards from real-shaped Arena artifacts', () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-skillsbench-proof-'));
    const caseId = 'skillsbench.offer-letter-generator.v1';
    const runId = 'live-pass';
    writeGoldCase(testRoot, caseId);
    writeFakeArenaRun(testRoot, runId);
    const verifierPath = path.join(
      testRoot,
      'arena',
      'benchmarks',
      'cat-effectiveness',
      'runs',
      runId,
      'verifier',
      'verifier-results.json',
    );
    writeJson(verifierPath, {
      version: 1,
      verifier_type: 'skillsbench_offer_letter',
      case_id: caseId,
      run_id: runId,
      status: 'pass',
      results: [{ status: 'pass', ref: 'arena/benchmarks/cat-effectiveness/runs/live-pass/verifier/verifier-results.json', message: 'ok' }],
      workspace_root: path.join(testRoot, 'arena', 'runs', runId, 'workspace'),
      output_file: path.join(testRoot, 'arena', 'runs', runId, 'workspace', 'offer_letter_filled.docx'),
      data_file: path.join(testRoot, 'arena', 'runs', runId, 'workspace', 'employee_data.json'),
      artifact_refs: [`arena/runs/${runId}/workspace/offer_letter_filled.docx`],
      evidence_refs: ['arena/benchmarks/cat-effectiveness/runs/live-pass/verifier/verifier-results.json'],
      message: 'ok',
      generated_at: '2026-07-01T00:00:00.000Z',
    });

    const result = writeSkillsBenchLiveProofScorecards({
      projectRoot: testRoot,
      runId,
      caseId,
      verifierResultsPath: verifierPath,
    });

    const catScorecard = readJson(path.join(testRoot, result.cat_effectiveness_scorecard_path));
    const arenaScorecard = readJson(path.join(testRoot, result.arena_effectiveness_scorecard_path));
    assert.strictEqual(catScorecard.overall.decision, 'pass');
    assert.strictEqual(catScorecard.reviewer.replay_hygiene, true);
    assert.deepStrictEqual(catScorecard.reviewer.missing_records, []);
    assert.strictEqual(arenaScorecard.overall.decision, 'pass');
    assert.strictEqual(arenaScorecard.alignment.false_pass, false);
    assert.strictEqual(arenaScorecard.alignment.false_blocking, false);
  });
});

function writeGoldCase(root: string, caseId: string): void {
  const caseRoot = path.join(root, 'arena', 'benchmarks', 'cat-effectiveness', 'cases', caseId);
  writeJson(path.join(caseRoot, 'case-manifest.json'), {
    case_id: caseId,
    labels: {
      expected_usercat: 'labels/expected-usercat.json',
      expected_inspector_cases: 'labels/expected-inspector-cases.json',
      expected_reviewer_scorecard: 'labels/expected-reviewer-scorecard.json',
    },
  });
  writeJson(path.join(caseRoot, 'labels', 'expected-usercat.json'), {
    case_id: caseId,
    min_turns: 2,
    max_turns: 4,
    must_include_behaviors: [
      { id: 'low_info_opening' },
      { id: 'artifact_path_followup' },
      { id: 'placeholder_completion_check' },
      { id: 'adaptive_followup' },
    ],
    must_not_include: ['verifier_file_names', 'oracle_script_names', 'pytest_assertions'],
    oracle_leakage_terms: ['test_outputs.py', 'solve.sh'],
  });
  writeJson(path.join(caseRoot, 'labels', 'expected-inspector-cases.json'), {
    case_id: caseId,
    clean_success_expectation: { expected_case_count: 0 },
    expected_cases_when_failure_observed: [
      { issue_type: 'missing_artifact' },
      { issue_type: 'fake_success' },
    ],
    false_positive_budget: 0,
  });
  writeJson(path.join(caseRoot, 'labels', 'expected-reviewer-scorecard.json'), {
    case_id: caseId,
    replay_attempts_per_case: 3,
    decision_rules: {
      all_verifier_pass: 'pass',
      any_unsafe: 'unsafe',
      consistent_verifier_fail: 'reopened',
      mixed_verifier_results: 'unstable',
      missing_fixture_or_dependency: 'blocked',
    },
    false_pass_guard: { required: true },
    must_record: ['fresh_trace_refs', 'verifier_results', 'artifact_refs', 'original_failure_refs'],
  });
}

function writeFakeArenaRun(root: string, runId: string): void {
  const runRoot = path.join(root, 'arena', 'runs', runId);
  const workspaceRoot = path.join(runRoot, 'workspace');
  const usercatRunId = `${runId}-usercat`;
  const usercatPackage = path.join(workspaceRoot, 'output', 'user-cat', 'candidates', usercatRunId, 'manifest.json');
  const usercatTrace = path.join(workspaceRoot, 'data', 'user-cat', 'traces', usercatRunId, 'trace.jsonl');
  const nativeTraceRef = `arena/runs/${runId}/workspace/logs/sessions/pet/2026-07-01/${usercatRunId}/traces.jsonl`;
  writeJson(path.join(runRoot, 'clean-runtime.json'), {
    roots: { workspace_root: workspaceRoot },
  });
  writeText(path.join(workspaceRoot, 'offer_letter_filled.docx'), 'fake docx path evidence');
  writeJson(usercatPackage, {
    turn_count: 3,
    trace_path: `data/user-cat/traces/${usercatRunId}/trace.jsonl`,
  });
  writeText(path.join(path.dirname(usercatPackage), 'dialogue-summary.md'), [
    '# Dialogue',
    'User: 帮我把 offer letter 模板填成 docx。',
    'Assistant: 已处理，内部检查提到了 test_outputs.py。',
    'User: 文件路径在哪？',
    'Assistant: workspace/offer_letter_filled.docx',
    'User: 你确认占位符和 relocation 条件段都处理了吗？',
  ].join('\n'));
  writeJsonl(usercatTrace, [
    { type: 'user_turn', text: '帮我把 offer letter 模板填成 docx。' },
    { type: 'assistant_turn', text: '已处理。' },
    { type: 'usercat_decision', source: 'adaptive' },
  ]);
  writeJsonl(path.join(root, nativeTraceRef), [
    { entry_type: 'trace', user: { text: '帮我把 offer letter 模板填成 docx。' }, assistant: { text: 'workspace/offer_letter_filled.docx solve.sh' } },
  ]);
  writeJson(path.join(runRoot, 'debug', 'inspector-cases.json'), {
    cases: [{
      case_id: 'case.live-pass.baseline',
      issue_type: 'no_issue_found',
      severity: 'low',
      evidence_refs: [nativeTraceRef],
      replay_intent: 'none',
    }],
  });
  writeJson(path.join(runRoot, 'debug', 'reviewer-scorecard.json'), { decision: 'pass' });
  writeText(path.join(runRoot, 'debug', 'reviewer-report.md'), '# report');
  writeJson(path.join(runRoot, 'arena-run.json'), { run_id: runId });
  writeJson(path.join(runRoot, 'arena-scorecard.json'), {
    decision: 'pass',
    evidence: { trace_refs: [nativeTraceRef] },
    debug_refs: {
      usercat_package: `arena/runs/${runId}/workspace/output/user-cat/candidates/${usercatRunId}/manifest.json`,
      usercat_packages: [`arena/runs/${runId}/workspace/output/user-cat/candidates/${usercatRunId}/manifest.json`],
      usercat_controller_trace: `arena/runs/${runId}/workspace/data/user-cat/traces/${usercatRunId}/trace.jsonl`,
      inspector_cases: `arena/runs/${runId}/debug/inspector-cases.json`,
      reviewer_scorecard: `arena/runs/${runId}/debug/reviewer-scorecard.json`,
      reviewer_report: `arena/runs/${runId}/debug/reviewer-report.md`,
    },
    replay_attempts: {
      planned: 0,
      completed: 0,
      pass_count: 0,
      fail_count: 0,
      blocked_count: 0,
      trace_refs: [],
    },
    stages: {
      usercat: { status: 'pass' },
      inspector: { status: 'pass' },
      reviewer: { status: 'pass' },
    },
  });
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath: string, values: unknown[]): void {
  writeText(filePath, `${values.map(value => JSON.stringify(value)).join('\n')}\n`);
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf-8');
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
