import { after, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import { createRoleAwareToolManager } from '../src/bootstrap/tool-manager';
import { SkillManager } from '../src/skills/skill-manager';
import { RoleResolver } from '../src/utils/role-resolver';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

function restoreRoleEnv(): void {
  if (originalRole) process.env.XIAOBA_ROLE = originalRole;
  else delete process.env.XIAOBA_ROLE;
  if (originalCurrentRole) process.env.CURRENT_ROLE = originalCurrentRole;
  else delete process.env.CURRENT_ROLE;
  if (originalCurrentRoleDisplayName) {
    process.env.CURRENT_ROLE_DISPLAY_NAME = originalCurrentRoleDisplayName;
  } else {
    delete process.env.CURRENT_ROLE_DISPLAY_NAME;
  }
}

describe('EngineerCat native XiaoBa runtime contract', () => {
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

  test('engineer alias activates a role with an explicit coding-tool allowlist', async () => {
    RoleResolver.activateRole('engineer');

    assert.strictEqual(RoleResolver.getActiveRoleName(), 'engineer-cat');
    const config = RoleResolver.getRoleConfig('engineer-cat');
    assert.strictEqual(config?.inheritBaseTools, false);
    assert.deepStrictEqual(config?.baseToolAllowlist, [
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'execute_shell',
      'skill',
      'ask_parent',
    ]);

    const manager = createRoleAwareToolManager(process.cwd(), {}, 'engineer-cat');
    const visibleToolNames = manager.getToolDefinitions().map(tool => tool.name);
    for (const toolName of ['read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute_shell']) {
      assert.ok(visibleToolNames.includes(toolName), `${toolName} should be visible to EngineerCat`);
    }
    assert.ok(visibleToolNames.includes('skill'));
    assert.ok(visibleToolNames.includes('ask_parent'));
    for (const removedToolName of [
      'spawn_subagent',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'engineer_task_run',
      'engineer_codex_supervisor_start',
      'codex_job_start',
    ]) {
      assert.strictEqual(visibleToolNames.includes(removedToolName), false);
    }

    const forcedControlCall = await manager.executeTool({
      id: 'engineer-forced-spawn',
      type: 'function',
      function: {
        name: 'spawn_subagent',
        arguments: JSON.stringify({
          task_description: 'must remain Base-owned',
          user_message: 'do not run',
        }),
      },
    });
    assert.strictEqual(forcedControlCall.status, 'blocked');

    const directAskParentCall = await manager.executeTool({
      id: 'engineer-direct-ask-parent',
      type: 'function',
      function: {
        name: 'ask_parent',
        arguments: JSON.stringify({ question: 'This call is not running in a SubAgent session.' }),
      },
    });
    assert.strictEqual(directAskParentCall.status, 'blocked');
    assert.strictEqual(directAskParentCall.error_code, 'TOOL_FORBIDDEN_FOR_CONTEXT');
  });

  test('EngineerCat keeps case implementation guidance without a nested task-runner skill', async () => {
    RoleResolver.activateRole('engineer-cat');
    const manager = new SkillManager();
    await manager.loadSkills();

    assert.ok(manager.getSkill('case-implementation'));
    assert.strictEqual(manager.getSkill('engineer-task-runner'), undefined);
  });

  test('runtime assets describe one XiaoBa Agent loop', () => {
    const roleConfig = JSON.parse(fs.readFileSync('roles/engineer-cat/role.json', 'utf-8')) as {
      description: string;
      aliases: string[];
      inheritBaseTools: boolean;
      baseToolAllowlist: string[];
    };
    const prompt = fs.readFileSync('roles/engineer-cat/prompts/engineer-system-prompt.md', 'utf-8');
    const behavior = fs.readFileSync('roles/engineer-cat/prompts/behavior.md', 'utf-8');

    assert.strictEqual(roleConfig.inheritBaseTools, false);
    assert.deepStrictEqual(roleConfig.baseToolAllowlist, [
      'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute_shell', 'skill', 'ask_parent',
    ]);
    assert.deepStrictEqual(roleConfig.aliases, ['engineer', 'coder']);
    assert.match(roleConfig.description, /共享 Agent loop 和受限 coding 工具/);
    assert.match(prompt, /同一套 XiaoBa Agent loop/);
    assert.match(prompt, /直接使用角色允许的 coding 工具/);
    assert.match(prompt, /用 `ask_parent` 向父会话请求输入/);
    assert.match(prompt, /属于父 Agent 调度控制面/);
    assert.match(behavior, /EngineerCat 本身就是执行者/);
    for (const content of [roleConfig.description, prompt, behavior]) {
      assert.doesNotMatch(content, /Codex|codex_job_|engineer_task_|engineer_codex_/i);
    }
  });
});
