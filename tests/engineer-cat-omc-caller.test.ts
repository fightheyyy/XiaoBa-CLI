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

describe('EngineerCat OMC caller skill', () => {
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

  test('engineer alias activates engineer-cat and loads omc-caller', async () => {
    RoleResolver.activateRole('engineer');

    assert.strictEqual(RoleResolver.getActiveRoleName(), 'engineer-cat');

    const manager = new SkillManager();
    await manager.loadSkills();

    const skill = manager.getSkill('omc-caller');
    assert.ok(skill, 'omc-caller skill should be available under engineer role');
    assert.strictEqual(skill.metadata.userInvocable, true);
    assert.strictEqual(skill.metadata.autoInvocable, true);
    assert.ok(skill.metadata.aliases?.includes('omc'));
    assert.ok(skill.metadata.aliases?.includes('codex-caller'));

    const matched = manager.findAutoInvocableSkillByText('请用 omc 让 codex 看一下这个实现');
    assert.strictEqual(matched?.metadata.name, 'omc-caller');
  });

  test('omc-caller contract is generic and has no personal checkout fallback', async () => {
    RoleResolver.activateRole('engineer');

    const manager = new SkillManager();
    await manager.loadSkills();
    const skill = manager.getSkill('omc-caller');
    assert.ok(skill);

    assert.match(skill.content, /OMC_BIN/);
    assert.match(skill.content, /npm i -g oh-my-claude-sisyphus@latest/);
    assert.match(skill.content, /PATH 中的 `omc`/);

    assert.doesNotMatch(skill.content, /\/Users\/guowei\//);
    assert.doesNotMatch(skill.content, /oh-my-claudecode/);
    assert.doesNotMatch(skill.content, /bridge\/cli\.cjs/);
  });

  test('engineer-task-runner is present for subagent use but hidden from user auto invocation', async () => {
    RoleResolver.activateRole('engineer');

    const manager = new SkillManager();
    await manager.loadSkills();
    const runner = manager.getSkill('engineer-task-runner');

    assert.ok(runner, 'engineer-task-runner should be loadable for spawn_subagent');
    assert.strictEqual(runner.metadata.userInvocable, false);
    assert.strictEqual(runner.metadata.autoInvocable, false);
    assert.match(runner.content, /ask_parent/);
    assert.match(runner.content, /data\/engineer-tasks\/<task-id>/);
  });

  test('EngineerCat docs do not reintroduce hardcoded local OMC paths', () => {
    const files = [
      'roles/engineer-cat/SPEC.md',
      'roles/engineer-cat/README.md',
      'roles/engineer-cat/prompts/engineer-system-prompt.md',
      'roles/engineer-cat/skills/omc-caller/SKILL.md',
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      assert.doesNotMatch(content, /\/Users\/guowei\//, `${file} should not contain personal paths`);
      assert.doesNotMatch(content, /oh-my-claudecode/, `${file} should not mention local checkout package`);
      assert.doesNotMatch(content, /bridge\/cli\.cjs/, `${file} should not mention checkout cli entry`);
    }
  });

  test('EngineerCat spec records confidence loop and current runner progress', () => {
    const content = fs.readFileSync('roles/engineer-cat/SPEC.md', 'utf-8');

    assert.match(content, /## 14\. Confidence Loop/);
    assert.match(content, /缺结构化输出时写入 blocked `engineer-output\.json`/);
    assert.match(content, /缺少 `implementation\.md`/);
    assert.match(content, /AutoDev 工程入口需要复用 `EngineerTaskRunner`/);
    assert.match(content, /`engineer_task_\*` runtime tool/);
    assert.match(content, /真实调用 PATH 中的本机 Codex CLI/);
    assert.match(content, /validation_status=passed/);
    assert.match(content, /validation_source=inferred/);
    assert.match(content, /真实 Feishu WebSocket、真实 AutoDev 服务联调、changed-file-aware targeted test 矩阵、外部 diff review gate 和 PR 闭环仍未完全代码化或验证/);
  });
});
