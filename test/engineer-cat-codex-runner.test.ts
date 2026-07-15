import { after, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import { RoleResolver } from '../src/utils/role-resolver';
import { SkillManager } from '../src/skills/skill-manager';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;
const originalAppRoot = process.env.XIAOBA_APP_ROOT;
const originalRolesRoot = process.env.XIAOBA_ROLES_ROOT;

function restoreRoleEnv(): void {
  if (originalRole) {
    process.env.XIAOBA_ROLE = originalRole;
  } else {
    delete process.env.XIAOBA_ROLE;
  }
  if (originalCurrentRole) {
    process.env.CURRENT_ROLE = originalCurrentRole;
  } else {
    delete process.env.CURRENT_ROLE;
  }
  if (originalCurrentRoleDisplayName) {
    process.env.CURRENT_ROLE_DISPLAY_NAME = originalCurrentRoleDisplayName;
  } else {
    delete process.env.CURRENT_ROLE_DISPLAY_NAME;
  }
  if (originalAppRoot) {
    process.env.XIAOBA_APP_ROOT = originalAppRoot;
  } else {
    delete process.env.XIAOBA_APP_ROOT;
  }
  if (originalRolesRoot) {
    process.env.XIAOBA_ROLES_ROOT = originalRolesRoot;
  } else {
    delete process.env.XIAOBA_ROLES_ROOT;
  }
}

describe('EngineerCat Codex runner role contract', () => {
  beforeEach(() => {
    process.chdir(originalCwd);
    restoreRoleEnv();
    RoleResolver.clearActiveRole();
  });

  after(() => {
    process.chdir(originalCwd);
    restoreRoleEnv();
    RoleResolver.clearActiveRole();
  });

  test('engineer alias activates engineer-cat without legacy external-provider caller skill', async () => {
    RoleResolver.activateRole('engineer');

    assert.strictEqual(RoleResolver.getActiveRoleName(), 'engineer-cat');

    const manager = new SkillManager();
    await manager.loadSkills();

    assert.strictEqual(manager.getSkill('omc-caller'), undefined);
    assert.strictEqual(manager.findAutoInvocableSkillByText('请用 omc 让 codex 看一下这个实现'), undefined);

    const runner = manager.getSkill('engineer-task-runner');
    assert.ok(runner, 'engineer-task-runner should remain loadable for spawn_subagent');
    assert.strictEqual(runner.metadata.userInvocable, false);
    assert.strictEqual(runner.metadata.autoInvocable, false);
    assert.match(runner.content, /engineer_task_run/);
    assert.match(runner.content, /data\/engineer-tasks\/<task-id>/);
  });

  test('EngineerCat runtime assets and central role docs describe the Codex runner path', () => {
    const files = [
      'docs/roles-skills/SPEC.md',
      'docs/roles-skills/PLAN.md',
      'roles/engineer-cat/role.json',
      'roles/engineer-cat/prompts/behavior.md',
      'roles/engineer-cat/prompts/engineer-system-prompt.md',
      'roles/engineer-cat/skills/engineer-task-runner/SKILL.md',
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      assert.doesNotMatch(content, /\bomc\b/i, `${file} should not mention legacy external-provider routing`);
      assert.doesNotMatch(content, /OMC_BIN/, `${file} should not mention legacy provider binary env`);
      assert.doesNotMatch(content, /oh-my-claude-sisyphus/, `${file} should not mention legacy provider package install`);
      assert.doesNotMatch(content, /Claude Code/, `${file} should not promise Claude Code routing`);
      assert.doesNotMatch(content, /\btmux\b/, `${file} should not promise tmux team routing`);
    }

    const spec = fs.readFileSync('docs/roles-skills/SPEC.md', 'utf-8');
    assert.match(spec, /EngineerCat.*代码.*工程/);
    assert.match(spec, /Inspector --> Gate/);
    assert.match(spec, /Gate -->\|repair\| Engineer/);
    assert.match(spec, /Engineer --> Reviewer/);

    const plan = fs.readFileSync('docs/roles-skills/PLAN.md', 'utf-8');
    assert.match(plan, /EngineerCat Codex\/coding takeover/);
  });

  test('dashboard role introduction source exposes the updated EngineerCat description', () => {
    const roleConfig = JSON.parse(fs.readFileSync('roles/engineer-cat/role.json', 'utf-8')) as { description: string };
    const dashboardApi = fs.readFileSync('src/dashboard/routes/api.ts', 'utf-8');

    assert.match(roleConfig.description, /本机 Codex runner/);
    assert.doesNotMatch(roleConfig.description, /\bomc\b/i);
    assert.doesNotMatch(roleConfig.description, /Claude Code/);
    assert.match(dashboardApi, /description: config\?\.description \|\| ''/);
  });
});
