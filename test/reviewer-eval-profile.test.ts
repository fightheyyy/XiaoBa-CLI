import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRoleAwareToolManager } from '../src/bootstrap/tool-manager';
import { prepareReviewEval } from '../src/roles/reviewer-cat/utils/review-eval-profile';
import { RoleResolver } from '../src/utils/role-resolver';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

describe('ReviewerCat eval profile preparation', () => {
  const originalCwd = process.cwd();
  const originalRole = process.env.XIAOBA_ROLE;
  const originalCurrentRole = process.env.CURRENT_ROLE;
  const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;
  let testRoot: string;

  beforeEach(() => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-reviewer-eval-'));
    process.chdir(testRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(testRoot, { recursive: true, force: true });
    restoreEnv('XIAOBA_ROLE', originalRole);
    restoreEnv('CURRENT_ROLE', originalCurrentRole);
    restoreEnv('CURRENT_ROLE_DISPLAY_NAME', originalCurrentRoleDisplayName);
    RoleResolver.clearActiveRole();
  });

  test('infers a web project and writes eval artifacts before tests run', () => {
    writeFile(path.join(testRoot, 'package.json'), JSON.stringify({
      scripts: {
        build: 'vite build',
        test: 'vitest run',
      },
      dependencies: {
        vite: '^5.0.0',
        react: '^18.0.0',
      },
    }, null, 2));
    writeFile(path.join(testRoot, 'index.html'), '<main id="root"></main>');

    const result = prepareReviewEval({
      cwd: testRoot,
      reviewId: 'web-review',
      request: 'Verify the dashboard works for a real user.',
      changedFiles: ['src/App.tsx'],
    });

    assert.strictEqual(result.profile.projectType, 'web');
    assert.ok(result.plan.requiredChecks.some(check => check.id === 'WEB-HUMAN-ENTRYPOINT'));
    assert.ok(result.plan.requiredChecks.some(check => check.id === 'WEB-E2E-HAPPY-PATH'));
    assert.ok(result.plan.optionalChecks.some(check => check.id === 'NODE-BUILD'));
    assert.ok(result.plan.reviewLenses.some(lens => lens.id === 'LENS-TEST-ENGINEER'));
    assert.ok(result.plan.reviewLenses.some(lens => lens.id === 'LENS-CODE-QUALITY'));
    assert.ok(result.plan.reviewLenses.some(lens => lens.id === 'LENS-SECURITY'));
    assert.ok(result.plan.reviewLenses.some(lens => lens.id === 'LENS-BROWSER-RUNTIME'));
    assert.ok(result.testMatrix.some(item => item.id === 'WEB-E2E-HAPPY-PATH'));
    assert.strictEqual(result.testMatrix.some(item => ['static', 'unit', 'integration', 'smoke'].includes(item.level)), false);
    assert.ok(fs.existsSync(result.paths.evaluationProfileMarkdown));
    assert.ok(fs.existsSync(result.paths.reviewEvalPlan));
    const reviewEvalPlan = fs.readFileSync(result.paths.reviewEvalPlan, 'utf-8');
    assert.ok(reviewEvalPlan.includes('Review Lenses'));
    assert.ok(reviewEvalPlan.includes('LENS-TEST-ENGINEER'));
    assert.ok(reviewEvalPlan.includes('LENS-BROWSER-RUNTIME'));
    assert.ok(reviewEvalPlan.includes('Closure Threshold'));
  });

  test('infers a CLI project and includes bad-input boundary checks', () => {
    writeFile(path.join(testRoot, 'package.json'), JSON.stringify({
      name: 'demo-cli',
      bin: {
        demo: './dist/index.js',
      },
      dependencies: {
        commander: '^11.0.0',
      },
    }, null, 2));

    const result = prepareReviewEval({
      cwd: testRoot,
      reviewId: 'cli-review',
      request: 'Verify CLI command behavior.',
    });

    assert.strictEqual(result.profile.projectType, 'cli');
    assert.ok(result.profile.entryPoints.some(entry => entry.type === 'cli'));
    assert.ok(result.plan.requiredChecks.some(check => check.id === 'CLI-HUMAN-TASK'));
    assert.ok(result.plan.requiredChecks.some(check => check.id === 'CLI-BAD-INPUT'));
    assert.ok(result.plan.optionalChecks.some(check => check.id === 'CLI-HELP-AUX'));
  });

  test('infers XiaoBa agent-runtime three-layer checks and role score rubrics', () => {
    writeFile(path.join(testRoot, 'package.json'), JSON.stringify({
      name: 'xiaoba-cli',
      bin: { xiaoba: './dist/index.js' },
      dependencies: { commander: '^11.0.0' },
    }, null, 2));
    writeFile(path.join(testRoot, 'roles', 'engineer-cat', 'role.json'), JSON.stringify({ name: 'engineer-cat' }, null, 2));
    writeFile(path.join(testRoot, 'roles', 'reviewer-cat', 'role.json'), JSON.stringify({ name: 'reviewer-cat' }, null, 2));
    writeFile(path.join(testRoot, 'test', 'agent-session-log.test.ts'), 'export {};');

    const result = prepareReviewEval({
      cwd: testRoot,
      reviewId: 'xiaoba-runtime',
      request: 'Evaluate XiaoBa roles as a human-like agent harness reviewer.',
    });

    assert.ok(result.profile.detectedProjectTypes.includes('agent-runtime'));
    assert.ok(result.profile.threeLayerStateModel.closureRules.some(rule => /provider transcript/i.test(rule)));
    assert.ok(result.profile.roleEffectivenessRubric.some(rubric => rubric.role === 'engineer-cat'));
    assert.ok(result.profile.roleEffectivenessRubric.some(rubric => rubric.role === 'reviewer-cat'));
    assert.ok(result.plan.reviewLenses.some(lens => lens.id === 'LENS-THREE-LAYER-HARNESS'));
    assert.ok(result.plan.requiredChecks.some(check => check.id === 'AGENT-THREE-LAYER-STATE' && check.automatable));
    assert.ok(result.plan.requiredChecks.some(check => check.id === 'XIAOBA-ROLE-EFFECTIVENESS-SCORECARD'));
    assert.ok(result.testMatrix.some(item => item.id === 'XIAOBA-ROLE-EFFECTIVENESS-SCORECARD'));

    const profileMarkdown = fs.readFileSync(result.paths.evaluationProfileMarkdown, 'utf-8');
    const boundaryMap = fs.readFileSync(result.paths.boundaryMap, 'utf-8');
    assert.match(profileMarkdown, /Three-Layer State Model/);
    assert.match(profileMarkdown, /Role Effectiveness Rubric/);
    assert.match(boundaryMap, /Role Effectiveness Targets/);
  });

  test('honors an existing project eval profile and still creates a review eval plan', () => {
    writeFile(path.join(testRoot, '.reviewercat', 'evaluation-profile.json'), JSON.stringify({
      version: 1,
      projectType: 'api',
      detectedProjectTypes: ['api'],
      primaryUsers: ['internal API client'],
      criticalInvariants: ['health endpoint must stay stable'],
      evidenceThresholds: {
        smoke: ['health returns 200'],
        e2e: ['core endpoint works'],
        closed: ['health and core endpoint evidence exist'],
      },
    }, null, 2));

    const result = prepareReviewEval({
      cwd: testRoot,
      reviewId: 'existing-profile',
      request: 'Verify API change.',
    });

    assert.strictEqual(result.profile.source, 'existing');
    assert.strictEqual(result.profile.projectType, 'api');
    assert.ok(result.plan.applicableProjectEvalRules.includes('health endpoint must stay stable'));
    assert.ok(result.plan.requiredChecks.some(check => check.id === 'API-HUMAN-FLOW'));
    assert.ok(result.plan.optionalChecks.some(check => check.id === 'API-HEALTH-AUX'));
  });

  test('preserves existing markdown eval profile content when using inferred defaults', () => {
    writeFile(path.join(testRoot, '.reviewercat', 'evaluation-profile.md'), [
      '# Project Eval Profile',
      '',
      '## Project-Specific Boundaries',
      '- only verify the primebot chain',
      '- do not touch shared Makefile targets',
    ].join('\n'));
    writeFile(path.join(testRoot, 'package.json'), JSON.stringify({
      scripts: { test: 'node --test' },
    }, null, 2));

    const result = prepareReviewEval({
      cwd: testRoot,
      reviewId: 'md-profile',
      request: 'Verify only the authorized chain.',
    });

    assert.strictEqual(result.profile.source, 'existing_with_inferred_defaults');
    assert.match(fs.readFileSync(result.paths.evaluationProfileMarkdown, 'utf-8'), /only verify the primebot chain/);
    assert.match(fs.readFileSync(result.paths.evaluationProfileMarkdown, 'utf-8'), /do not touch shared Makefile targets/);
  });

  test('reviewer role registers eval preparation tool', () => {
    fs.mkdirSync(path.join(testRoot, 'roles', 'reviewer-cat'), { recursive: true });
    writeFile(path.join(testRoot, 'roles', 'reviewer-cat', 'role.json'), JSON.stringify({
      name: 'reviewer-cat',
      displayName: 'ReviewerCat',
      aliases: ['reviewer'],
    }, null, 2));

    RoleResolver.activateRole('reviewer');
    const manager = createRoleAwareToolManager(testRoot);

    assert.ok(manager.getTool('reviewer_eval_prepare'));
    assert.ok(manager.getTool('reviewer_module_test'));
  });

  test('ReviewerCat prompt and spec include distilled multi-lens review model', () => {
    const spec = fs.readFileSync(path.join(originalCwd, 'roles', 'reviewer-cat', 'SPEC.md'), 'utf-8');
    const prompt = fs.readFileSync(path.join(originalCwd, 'roles', 'reviewer-cat', 'prompts', 'reviewer-system-prompt.md'), 'utf-8');

    for (const content of [spec, prompt]) {
      assert.match(content, /test-engineer lens/);
      assert.match(content, /code-quality lens/);
      assert.match(content, /security lens/);
      assert.match(content, /runtime-e2e lens/);
      assert.match(content, /debugging-recovery lens/);
      assert.match(content, /三层/);
      assert.match(content, /role effectiveness/i);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
