import { after, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { createRoleAwareToolManager } from '../src/bootstrap/tool-manager';
import { getRoleSpecificToolsForRole, startRoleRuntimeServices } from '../src/roles/runtime-role-registry';
import { SkillManager } from '../src/skills/skill-manager';
import { PromptManager } from '../src/utils/prompt-manager';
import { RoleResolver } from '../src/utils/role-resolver';

const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

function fakeChannel(surface: string) {
  return {
    chatId: `${surface}-chat`,
    reply: async () => undefined,
    sendFile: async () => undefined,
  };
}

function restoreEnv(): void {
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
}

describe('RouterCat role', () => {
  beforeEach(() => {
    RoleResolver.clearActiveRole();
  });

  after(() => {
    restoreEnv();
  });

  test('role assets exist and alias activation resolves to router-cat', () => {
    const rolePath = path.join(process.cwd(), 'roles', 'router-cat', 'role.json');
    assert.ok(fs.existsSync(rolePath));

    const config = JSON.parse(fs.readFileSync(rolePath, 'utf-8'));
    assert.equal(config.name, 'router-cat');
    assert.equal(config.displayName, 'RouterCat');
    assert.equal(config.promptFile, 'router-system-prompt.md');
    assert.equal(config.inheritBaseSkills, false);
    assert.equal(config.inheritBaseTools, false);
    assert.deepEqual(config.baseToolAllowlist, [
      'spawn_subagent',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'read_file',
      'grep',
      'glob',
    ]);
    assert.ok(config.aliases.includes('router'));
    assert.ok(config.aliases.includes('im-router'));

    RoleResolver.activateRole('router');
    assert.equal(RoleResolver.getActiveRoleName(), 'router-cat');
    assert.equal(process.env.CURRENT_ROLE_DISPLAY_NAME, 'RouterCat');
  });

  test('prompt encodes control-plane role-only dispatch rules', async () => {
    const promptSource = fs.readFileSync(
      path.join(process.cwd(), 'roles', 'router-cat', 'prompts', 'router-system-prompt.md'),
      'utf-8',
    );
    const prompt = await PromptManager.buildSystemPrompt({ roleName: 'router-cat' });

    assert.match(promptSource, /\{\{\s*include:surface\.md\s*\}\}/);
    assert.doesNotMatch(promptSource, /工作流程：/);
    assert.doesNotMatch(prompt, /\{\{\s*include:surface\.md\s*\}\}/);
    assert.match(prompt, /IM 控制平面角色/);
    assert.match(prompt, /spawn_subagent/);
    assert.match(prompt, /跨 role 派发只传 `role_name`/);
    assert.match(prompt, /不使用 `skill` 工具/);
    assert.match(prompt, /只有 send_text 和 send_file 会产生用户可见输出/);
    assert.match(prompt, /普通最终回复、thinking、tool result、subagent 状态注入和日志都只是 runtime \/ trace 上下文/);
    assert.match(prompt, /代码开发[\s\S]*`engineer-cat`/);
    assert.match(prompt, /论文精读[\s\S]*`researcher-cat`/);
    assert.match(prompt, /日志分析[\s\S]*`inspector-cat`/);
    assert.match(prompt, /端到端验收[\s\S]*`reviewer-cat`/);
    assert.match(prompt, /日程[\s\S]*`secretary-cat`/);
    assert.match(prompt, /当前角色：RouterCat/);
  });

  test('loads no inherited skills and exposes only control-plane plus readonly tools', async () => {
    const skillManager = new SkillManager('router-cat');
    await skillManager.loadSkills();
    assert.deepEqual(skillManager.getAllSkills().map(skill => skill.metadata.name), []);

    assert.deepEqual(getRoleSpecificToolsForRole('router-cat').map(tool => tool.definition.name), []);
    RoleResolver.activateRole('router-cat');
    assert.equal(await startRoleRuntimeServices({ workingDirectory: process.cwd() }), null);

    const manager = createRoleAwareToolManager(process.cwd(), {}, 'router-cat');
    const toolNames = manager.getToolDefinitions().map(tool => tool.name).sort();

    for (const expected of [
      'spawn_subagent',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'read_file',
      'grep',
      'glob',
    ]) {
      assert.ok(toolNames.includes(expected), `${expected} should be visible`);
    }

    for (const forbidden of [
      'write_file',
      'edit_file',
      'execute_shell',
      'skill',
      'ask_parent',
      'engineer_task_run',
      'engineer_codex_supervisor_start',
      'research_board_update',
      'auto_research_run',
      'reviewer_eval_prepare',
      'reviewer_xiaoba_cli_e2e',
      'analyze_log',
      'feishu_message_send_confirmed',
      'guide_tpc_baseline',
      'user_trace_run',
    ]) {
      assert.ok(!toolNames.includes(forbidden), `${forbidden} should be hidden`);
    }
  });

  test('exposes delivery tools only on channel-backed surfaces', () => {
    const cliManager = createRoleAwareToolManager(process.cwd(), { surface: 'cli' }, 'router-cat');
    assert.ok(!cliManager.getToolDefinitions().some(tool => tool.name === 'send_text'));
    assert.ok(!cliManager.getToolDefinitions().some(tool => tool.name === 'send_file'));

    for (const surface of ['feishu', 'weixin', 'pet'] as const) {
      const missingChannelManager = createRoleAwareToolManager(process.cwd(), { surface }, 'router-cat');
      assert.ok(!missingChannelManager.getToolDefinitions().some(tool => tool.name === 'send_text'));
      assert.ok(!missingChannelManager.getToolDefinitions().some(tool => tool.name === 'send_file'));

      const manager = createRoleAwareToolManager(process.cwd(), {
        surface,
        channel: fakeChannel(surface),
      }, 'router-cat');
      const toolNames = manager.getToolDefinitions().map(tool => tool.name);
      assert.ok(toolNames.includes('send_text'), `${surface} should expose send_text`);
      assert.ok(toolNames.includes('send_file'), `${surface} should expose send_file`);
    }
  });
});
