import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(projectRoot, 'arena', 'benchmarks', 'cat-effectiveness');
const caseIds = [
  'skillsbench.offer-letter-generator.v1',
  'skillsbench.citation-check.v1',
  'skillsbench.dialogue-parser.v1',
  'skillsbench.xlsx-recover-data.v1',
  'skillsbench.lab-unit-harmonization.v1',
  'skillsbench.sales-pivot-analysis.v1',
  'skillsbench.software-dependency-audit.v1',
];

describe('Arena Cat effectiveness gold data', () => {
  test('seeds SkillsBench cases with provenance and hidden judge refs', () => {
    const source = readJson(path.join(dataRoot, 'sources', 'skillsbench', 'source-manifest.json'));

    assert.strictEqual(source.source_id, 'skillsbench');
    assert.strictEqual(source.repo, 'https://github.com/benchflow-ai/skillsbench');
    assert.match(source.pinned_commit, /^[a-f0-9]{40}$/);
    assert.strictEqual(source.repo_license, 'Apache-2.0');
    assert.strictEqual(source.candidate_cases[0].case_id, 'skillsbench.offer-letter-generator.v1');
    assert.strictEqual(source.candidate_cases[0].priority, 'first_slice');

    for (const caseId of caseIds) {
      const manifest = readCaseManifest(caseId);
      assert.strictEqual(manifest.case_id, caseId);
      assert.strictEqual(manifest.case_type, 'cat_effectiveness_gold_case');
      assert.strictEqual(manifest.source.commit, source.pinned_commit);
      assert.ok(source.candidate_cases.some((item: any) => item.case_id === caseId));
      assert.ok(manifest.task.expected_artifacts.length > 0);
      assert.ok(manifest.task.hidden_oracle_refs.every((ref: string) => ref.includes('/oracle/')));
      assert.ok(manifest.task.hidden_verifier_refs.every((ref: string) => ref.includes('/verifier/')));
      assert.ok(['external_ref', 'materialized_local', 'materialized_local_bundle'].includes(manifest.subjects.skills[0].materialization));
    }
  });

  test('materializes the offer-letter first slice locally', () => {
    const caseRoot = caseRootFor('skillsbench.offer-letter-generator.v1');
    const manifest = readCaseManifest('skillsbench.offer-letter-generator.v1');

    assert.strictEqual(manifest.status, 'materialized_local');
    assert.strictEqual(manifest.subjects.skills_root, 'subject-skills');
    assert.strictEqual(manifest.subjects.skills[0].materialization, 'materialized_local');
    assert.ok(fs.existsSync(path.join(caseRoot, 'workspace', 'employee_data.json')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'workspace', 'offer_letter_template.docx')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'subject-skills', 'docx', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'verifier', 'test_outputs.py')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'oracle', 'solve.sh')));
  });

  test('materializes the citation-check holdout slice locally', () => {
    const caseRoot = caseRootFor('skillsbench.citation-check.v1');
    const manifest = readCaseManifest('skillsbench.citation-check.v1');

    assert.strictEqual(manifest.status, 'materialized_local');
    assert.strictEqual(manifest.subjects.skills_root, 'subject-skills');
    assert.strictEqual(manifest.subjects.skills[0].materialization, 'materialized_local');
    assert.ok(fs.existsSync(path.join(caseRoot, 'workspace', 'test.bib')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'subject-skills', 'citation-management', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'subject-skills', 'citation-management', 'scripts', 'validate_citations.py')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'verifier', 'test_outputs.py')));
    assert.ok(fs.existsSync(path.join(caseRoot, 'oracle', 'solve.sh')));
  });

  test('materializes broad holdout slices locally', () => {
    const expectedFixtures: Record<string, string[]> = {
      'skillsbench.dialogue-parser.v1': ['script.txt'],
      'skillsbench.xlsx-recover-data.v1': ['nasa_budget_incomplete.xlsx'],
      'skillsbench.lab-unit-harmonization.v1': [
        path.join('data', 'ckd_lab_data.csv'),
        path.join('data', 'ckd_feature_descriptions.csv'),
      ],
      'skillsbench.sales-pivot-analysis.v1': ['income.xlsx', 'population.pdf'],
      'skillsbench.software-dependency-audit.v1': ['package-lock.json'],
    };

    for (const [caseId, fixturePaths] of Object.entries(expectedFixtures)) {
      const caseRoot = caseRootFor(caseId);
      const manifest = readCaseManifest(caseId);

      assert.strictEqual(manifest.status, 'materialized_local');
      assert.strictEqual(manifest.subjects.skills_root, 'subject-skills');
      assert.strictEqual(manifest.subjects.skills[0].materialization, 'materialized_local_bundle');
      assert.ok(fs.existsSync(path.join(caseRoot, 'task.md')));
      assert.ok(fs.existsSync(path.join(caseRoot, 'verifier', 'test_outputs.py')));
      assert.ok(fs.existsSync(path.join(caseRoot, 'oracle', 'solve.sh')));
      for (const fixturePath of fixturePaths) {
        assert.ok(fs.existsSync(path.join(caseRoot, 'workspace', fixturePath)), `${caseId} fixture missing: ${fixturePath}`);
      }
    }
  });

  test('keeps oracle answers out of the UserCat-facing task seed', () => {
    for (const caseId of caseIds) {
      const caseRoot = caseRootFor(caseId);
      const task = fs.readFileSync(path.join(caseRoot, 'task.md'), 'utf-8');
      const usercat = readJson(path.join(caseRoot, 'labels', 'expected-usercat.json'));

      assert.ok(task.length > 80);
      assert.ok(!task.includes('verifier'));
      assert.ok(!task.includes('oracle'));

      for (const leakedTerm of usercat.oracle_leakage_terms) {
        assert.ok(!task.includes(leakedTerm), `${caseId} task seed leaked hidden oracle term: ${leakedTerm}`);
      }
    }
  });

  test('defines separate labels for UserCat, InspectorCat and ReviewerCat', () => {
    for (const caseId of caseIds) {
      const caseRoot = caseRootFor(caseId);
      const manifest = readJson(path.join(caseRoot, 'case-manifest.json'));
      const usercat = readJson(path.join(caseRoot, manifest.labels.expected_usercat));
      const inspector = readJson(path.join(caseRoot, manifest.labels.expected_inspector_cases));
      const reviewer = readJson(path.join(caseRoot, manifest.labels.expected_reviewer_scorecard));

      assert.strictEqual(usercat.label_type, 'expected_usercat');
      assert.ok(usercat.must_include_behaviors.some((item: any) => item.id === 'low_info_opening'));
      assert.ok(usercat.must_include_behaviors.some((item: any) => item.id === 'artifact_path_followup'));

      assert.strictEqual(inspector.label_type, 'expected_inspector_cases');
      assert.strictEqual(inspector.false_positive_budget, 0);
      assert.ok(inspector.expected_cases_when_failure_observed.some((item: any) => item.issue_type === 'missing_artifact'));
      assert.ok(inspector.expected_cases_when_failure_observed.some((item: any) => item.issue_type === 'fake_success'));

      assert.strictEqual(reviewer.label_type, 'expected_reviewer_scorecard');
      assert.strictEqual(reviewer.false_pass_guard.required, true);
      assert.strictEqual(reviewer.decision_rules.all_verifier_pass, 'pass');
      assert.strictEqual(reviewer.decision_rules.consistent_verifier_fail, 'reopened');
      assert.ok(reviewer.expected_hidden_answer?.visibility === 'scorer_only'
        || reviewer.expected_hidden_checks?.visibility === 'scorer_only');
    }
  });
});

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function caseRootFor(caseId: string): string {
  return path.join(dataRoot, 'cases', caseId);
}

function readCaseManifest(caseId: string): any {
  return readJson(path.join(caseRootFor(caseId), 'case-manifest.json'));
}
