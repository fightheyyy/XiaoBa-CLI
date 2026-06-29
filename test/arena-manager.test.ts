import { after, afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArenaManager, DEFAULT_PACKAGED_BASE_SKILLS } from '../src/arena/arena-manager';
import { RoleResolver } from '../src/utils/role-resolver';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;
const originalRolesRoot = process.env.XIAOBA_ROLES_ROOT;
const originalProjectRoot = process.env.XIAOBA_PROJECT_ROOT;
const originalSkillsRoot = process.env.XIAOBA_SKILLS_ROOT;
const originalArenaSecret = process.env.ARENA_SECRET;

describe('ArenaManager', () => {
  let testRoot = '';
  let manager: ArenaManager;

  beforeEach(() => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-arena-'));
    process.chdir(testRoot);
    delete process.env.XIAOBA_ROLES_ROOT;
    delete process.env.XIAOBA_PROJECT_ROOT;
    delete process.env.XIAOBA_SKILLS_ROOT;
    delete process.env.ARENA_SECRET;
    manager = new ArenaManager({
      projectRoot: testRoot,
      now: () => new Date('2026-06-29T00:00:00.000Z'),
    });
    writeBaseSkills(testRoot);
    writeRole(testRoot, 'engineer-cat', {
      name: 'engineer-cat',
      displayName: 'EngineerCat',
      description: 'Implementation role',
      baseToolAllowlist: ['read_file'],
      metadata: { boundary: 'Implement changes with evidence.' },
    });
    writeSkill(path.join(testRoot, 'roles', 'engineer-cat', 'skills', 'engineer-helper'), {
      name: 'engineer-helper',
      description: 'Engineer helper',
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  after(() => {
    process.chdir(originalCwd);
    restoreEnv('XIAOBA_ROLE', originalRole);
    restoreEnv('CURRENT_ROLE', originalCurrentRole);
    restoreEnv('CURRENT_ROLE_DISPLAY_NAME', originalCurrentRoleDisplayName);
    restoreEnv('XIAOBA_ROLES_ROOT', originalRolesRoot);
    restoreEnv('XIAOBA_PROJECT_ROOT', originalProjectRoot);
    restoreEnv('XIAOBA_SKILLS_ROOT', originalSkillsRoot);
    restoreEnv('ARENA_SECRET', originalArenaSecret);
  });

  test('imports a local skill as an arena-only subject manifest', () => {
    writeSkill(path.join(testRoot, 'fixtures', 'skills', 'report-writer'), {
      name: 'report-writer',
      description: 'Writes reports with visible artifacts',
      body: 'Create reports. Never leak token values.',
    });

    const manifest = manager.importLocalSkill({
      skillPath: 'fixtures/skills/report-writer',
    });

    assert.strictEqual(manifest.subject.type, 'skill');
    assert.strictEqual(manifest.subject.name, 'report-writer');
    assert.strictEqual(manifest.trust_level, 'review_required');
    assert.strictEqual(manifest.allowed_runtime, 'arena_only');
    assert.ok(manifest.parsed.skill_files.includes('fixtures/skills/report-writer/SKILL.md'));
    assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(path.join(
      testRoot,
      'arena',
      'subjects',
      manifest.subject_id,
      'arena-manifest.json',
    )));
  });

  test('snapshots a role without mutating production role files', () => {
    const rolePath = path.join(testRoot, 'roles', 'engineer-cat');
    const before = fs.readdirSync(rolePath).sort();

    const manifest = manager.snapshotRole({ roleId: 'engineer-cat' });

    assert.strictEqual(manifest.subject.type, 'role');
    assert.strictEqual(manifest.subject.name, 'engineer-cat');
    assert.strictEqual(manifest.role?.id, 'engineer-cat');
    assert.deepStrictEqual(manifest.role?.local_skills, ['engineer-helper']);
    assert.ok(manifest.role?.declared_boundaries.includes('Implement changes with evidence.'));
    assert.deepStrictEqual(fs.readdirSync(rolePath).sort(), before);
  });

  test('creates role_skill run index from real UserCat, trace, Inspector and Reviewer refs', () => {
    const skillManifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'patch-helper'), {
        name: 'patch-helper',
        description: 'Helps patch files',
      }),
    });
    const refs = writeEvidenceRefs(testRoot);

    const run = manager.createRunIndex({
      runId: 'role-skill-pass',
      reviewMode: 'role_skill',
      subjectId: skillManifest.subject_id,
      targetRoleId: 'engineer-cat',
      surface: 'pet',
      usercatRunRef: {
        run_id: 'usercat-real-run',
        package_path: refs.usercatPackage,
        trace_refs: [refs.nativeTrace],
      },
      traceRefs: [refs.nativeTrace],
      inspectorRefs: [refs.inspectorCase],
      reviewerRef: {
        run_id: 'reviewer-pass',
        scorecard_path: refs.scorecard,
        report_path: refs.report,
      },
      replayAttempts: {
        planned: 3,
        completed: 3,
        pass_count: 3,
        fail_count: 0,
        blocked_count: 0,
        trace_refs: [refs.replayTrace],
      },
      decision: 'pass',
      scorecardSummary: 'stable across replay attempts',
    });

    assert.strictEqual(run.review_mode, 'role_skill');
    assert.strictEqual(run.decision, 'pass');
    assert.strictEqual(run.target_profile.active_role_id, 'engineer-cat');
    assert.strictEqual(run.target_profile.subject_skill_id, 'patch-helper');
    assert.ok(run.target_profile.loaded_skills.includes('patch-helper'));
    assert.ok(run.target_profile.loaded_skills.includes('engineer-helper'));
    assert.ok(DEFAULT_PACKAGED_BASE_SKILLS.every(skill => run.target_profile.loaded_skills.includes(skill)));
    assert.deepStrictEqual(run.replay_attempts, {
      planned: 3,
      completed: 3,
      pass_count: 3,
      fail_count: 0,
      blocked_count: 0,
      trace_refs: [refs.replayTrace],
    });
    assert.ok(fs.existsSync(path.join(testRoot, 'arena', 'runs', 'role-skill-pass', 'arena-run.json')));
  });

  test('prepares a clean base_skill runtime with only base skills and subject skill', () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'rating-skill'), {
        name: 'rating-skill',
        description: 'Rates evidence',
      }),
    });
    process.env.ARENA_SECRET = 'super-secret-value';

    const runtime = manager.prepareCleanRuntime({
      runId: 'clean-base-skill',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      passThroughEnv: ['ARENA_SECRET'],
    });

    assert.strictEqual(runtime.review_mode, 'base_skill');
    assert.strictEqual(runtime.target_profile.active_role_id, 'base');
    assert.ok(fs.existsSync(path.join(runtime.roots.skills_root, 'rating-skill', 'SKILL.md')));
    assert.ok(DEFAULT_PACKAGED_BASE_SKILLS.every(skill => (
      fs.existsSync(path.join(runtime.roots.skills_root, skill, 'SKILL.md'))
    )));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(runtime.roots.workspace_root, 'skill-registry.json'), 'utf-8')), []);
    assert.strictEqual(runtime.launch.cwd, runtime.roots.workspace_root);
    assert.strictEqual(runtime.launch.env.XIAOBA_PROJECT_ROOT, testRoot);
    assert.strictEqual(runtime.launch.env.XIAOBA_SKILLS_ROOT, runtime.roots.skills_root);
    assert.strictEqual(runtime.launch.env.XIAOBA_ROLES_ROOT, runtime.roots.roles_root);
    assert.strictEqual(runtime.launch.env.HOME, runtime.roots.home_root);
    assert.strictEqual(runtime.sandbox.subject_root, path.join(runtime.roots.run_root, 'skills', 'rating-skill'));
    assert.ok(!runtime.launch.command.includes('--role'));
    assert.ok(runtime.launch.pass_through_env.includes('ARENA_SECRET'));
    assert.match(runtime.launch.shell_command, /ARENA_SECRET="\$\{ARENA_SECRET\}"/);

    const runtimeJson = fs.readFileSync(path.join(testRoot, 'arena', 'runs', 'clean-base-skill', 'clean-runtime.json'), 'utf-8');
    assert.ok(!runtimeJson.includes('super-secret-value'));
  });

  test('prepares a clean role_skill runtime with copied target role and subject skill', () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'patch-helper'), {
        name: 'patch-helper',
        description: 'Helps patch files',
      }),
    });

    const runtime = manager.prepareCleanRuntime({
      runId: 'clean-role-skill',
      reviewMode: 'role_skill',
      subjectId: manifest.subject_id,
      targetRoleId: 'engineer-cat',
    });

    assert.strictEqual(runtime.target_profile.active_role_id, 'engineer-cat');
    assert.strictEqual(runtime.target_profile.subject_skill_id, 'patch-helper');
    assert.ok(fs.existsSync(path.join(runtime.roots.skills_root, 'patch-helper', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(runtime.roots.roles_root, 'engineer-cat', 'role.json')));
    assert.ok(fs.existsSync(path.join(runtime.roots.roles_root, 'engineer-cat', 'skills', 'engineer-helper', 'SKILL.md')));
    assert.deepStrictEqual(runtime.launch.command.slice(-2), ['--role', 'engineer-cat']);
    assert.strictEqual(runtime.copied.role, 'roles/engineer-cat');
    assert.strictEqual(runtime.copied.subject_skill, 'skills/patch-helper');
    assert.strictEqual(runtime.sandbox.subject_root, path.join(runtime.roots.run_root, 'skills', 'patch-helper'));
  });

  test('prepares a clean role runtime from the role subject snapshot', () => {
    const manifest = manager.snapshotRole({ roleId: 'engineer-cat' });

    const runtime = manager.prepareCleanRuntime({
      runId: 'clean-role',
      reviewMode: 'role',
      subjectId: manifest.subject_id,
      targetRoleId: 'engineer-cat',
    });

    assert.strictEqual(runtime.review_mode, 'role');
    assert.strictEqual(runtime.target_profile.active_role_id, 'engineer-cat');
    assert.strictEqual(runtime.copied.subject_skill, undefined);
    assert.strictEqual(runtime.copied.role, 'roles/engineer-cat');
    assert.strictEqual(runtime.sandbox.subject_root, path.join(runtime.roots.run_root, 'roles', 'engineer-cat'));
    assert.ok(fs.existsSync(path.join(runtime.roots.roles_root, 'engineer-cat', 'role.json')));
    assert.ok(fs.existsSync(path.join(runtime.roots.roles_root, 'engineer-cat', 'skills', 'engineer-helper', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(runtime.roots.skills_root, 'engineer-helper', 'SKILL.md')));
  });

  test('marks mixed replay attempts as unstable rather than pass', () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'flaky-helper'), {
        name: 'flaky-helper',
        description: 'Sometimes produces artifacts',
      }),
    });
    const refs = writeEvidenceRefs(testRoot);

    const run = manager.createRunIndex({
      runId: 'flaky-run',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      usercatRunRef: {
        run_id: 'usercat-flaky',
        package_path: refs.usercatPackage,
        trace_refs: [refs.nativeTrace],
      },
      traceRefs: [refs.nativeTrace],
      inspectorRefs: [refs.inspectorCase],
      reviewerRef: {
        run_id: 'reviewer-flaky',
        scorecard_path: refs.scorecard,
        report_path: refs.report,
      },
      replayAttempts: {
        planned: 3,
        completed: 3,
        pass_count: 2,
        fail_count: 1,
        blocked_count: 0,
        trace_refs: [refs.replayTrace],
      },
      decision: 'unstable',
    });

    assert.strictEqual(run.decision, 'unstable');
    assert.strictEqual(run.target_profile.active_role_id, 'base');
  });

  test('rejects pass without stable replay attempts', () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'bad-pass'), {
        name: 'bad-pass',
        description: 'Bad pass',
      }),
    });
    const refs = writeEvidenceRefs(testRoot);

    assert.throws(
      () => manager.createRunIndex({
        runId: 'bad-pass',
        reviewMode: 'base_skill',
        subjectId: manifest.subject_id,
        usercatRunRef: {
          run_id: 'usercat-bad',
          package_path: refs.usercatPackage,
          trace_refs: [refs.nativeTrace],
        },
        traceRefs: [refs.nativeTrace],
        inspectorRefs: [refs.inspectorCase],
        reviewerRef: {
          run_id: 'reviewer-bad',
          scorecard_path: refs.scorecard,
          report_path: refs.report,
        },
        replayAttempts: {
          planned: 3,
          completed: 3,
          pass_count: 2,
          fail_count: 1,
          blocked_count: 0,
          trace_refs: [refs.replayTrace],
        },
        decision: 'pass',
      }),
      /pass requires completed replay attempts/,
    );
  });
});

function writeBaseSkills(root: string): void {
  for (const skill of DEFAULT_PACKAGED_BASE_SKILLS) {
    writeSkill(path.join(root, 'skills', skill), {
      name: skill,
      description: `${skill} base skill`,
    });
  }
}

function writeSkill(
  dirPath: string,
  input: { name: string; description: string; body?: string },
): string {
  fs.mkdirSync(dirPath, { recursive: true });
  const skillPath = path.join(dirPath, 'SKILL.md');
  fs.writeFileSync(skillPath, [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    '---',
    '',
    input.body || 'Use evidence.',
    '',
  ].join('\n'), 'utf-8');
  return skillPath;
}

function writeRole(root: string, roleName: string, config: Record<string, unknown>): void {
  const roleDir = path.join(root, 'roles', roleName);
  fs.mkdirSync(path.join(roleDir, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(roleDir, 'role.json'), JSON.stringify(config, null, 2), 'utf-8');
  fs.writeFileSync(path.join(roleDir, 'README.md'), `# ${roleName}\n`, 'utf-8');
  fs.writeFileSync(path.join(roleDir, 'SPEC.md'), `# ${roleName} SPEC\n`, 'utf-8');
  fs.writeFileSync(path.join(roleDir, 'prompts', 'system.md'), 'Role prompt.', 'utf-8');
}

function writeEvidenceRefs(root: string): {
  usercatPackage: string;
  nativeTrace: string;
  inspectorCase: string;
  scorecard: string;
  report: string;
  replayTrace: string;
} {
  const usercatPackage = 'output/user-cat/candidates/usercat-real-run/manifest.json';
  const nativeTrace = 'logs/sessions/pet/2026-06-29/session/traces.jsonl';
  const inspectorCase = 'output/inspector/arena-case.json';
  const scorecard = 'data/reviewer-runs/reviewer-pass/scorecard.json';
  const report = 'data/reviewer-runs/reviewer-pass/report.md';
  const replayTrace = 'output/replay/arena-pass/replay-results.json';
  writeJson(path.join(root, usercatPackage), { run_id: 'usercat-real-run' });
  writeText(path.join(root, nativeTrace), '{"entry_type":"trace","user":{"text":"do it"}}\n');
  writeJson(path.join(root, inspectorCase), { issue_type: 'missing_artifact' });
  writeJson(path.join(root, scorecard), { decision: 'pass' });
  writeText(path.join(root, report), '# Reviewer Report\n');
  writeJson(path.join(root, replayTrace), { attempts: 3 });
  return { usercatPackage, nativeTrace, inspectorCase, scorecard, report, replayTrace };
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf-8');
}

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
