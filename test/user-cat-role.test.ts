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

describe('UserCat role', () => {
  beforeEach(() => {
    RoleResolver.clearActiveRole();
  });

  after(() => {
    restoreEnv();
  });

  test('role assets exist and alias activation resolves to user-cat', () => {
    const rolePath = path.join(process.cwd(), 'roles', 'user-cat', 'role.json');
    assert.ok(fs.existsSync(rolePath));

    const config = JSON.parse(fs.readFileSync(rolePath, 'utf-8'));
    assert.equal(config.name, 'user-cat');
    assert.equal(config.promptFile, 'user-system-prompt.md');
    assert.equal(config.inheritBaseSkills, false);
    assert.equal(config.inheritBaseTools, false);
    assert.deepEqual(config.baseToolAllowlist, ['read_file', 'grep', 'glob', 'skill']);
    assert.equal(config.metadata.benchmarkAcceptance, 'forbidden');

    RoleResolver.activateRole('low info user');
    assert.equal(RoleResolver.getActiveRoleName(), 'user-cat');
    assert.equal(process.env.CURRENT_ROLE_DISPLAY_NAME, 'UserCat');
  });

  test('prompt encodes low-information trace production and forbids judgement', async () => {
    const prompt = await PromptManager.buildSystemPrompt({ roleName: 'user-cat' });

    assert.match(prompt, /realistic low-information user pressure role/);
    assert.match(prompt, /Dumb Enough/);
    assert.match(prompt, /role_intent_map/);
    assert.match(prompt, /xiaoba-cli-product-test/);
    assert.match(prompt, /Never:[\s\S]*judge target role pass\/fail/);
    assert.match(prompt, /Do not use shell, write, edit, subagent/);
    assert.match(prompt, /recommended_next_owner/);
    assert.match(prompt, /当前角色：UserCat/);
  });

  test('only role-local UserCat skills are loaded', async () => {
    const manager = new SkillManager('user-cat');
    await manager.loadSkills();

    assert.deepEqual(manager.getAllSkills().map(skill => skill.metadata.name).sort(), [
      'trace-simulation',
      'xiaoba-cli-product-test',
    ]);

    const skill = manager.getSkill('trace-simulation');
    assert.ok(skill);
    assert.equal(skill.metadata.userInvocable, true);
    assert.equal(skill.metadata.autoInvocable, true);
    assert.match(skill.content, /UserCat creates candidate trace data/);
    assert.match(skill.content, /ReviewerCat curates and judges evidence/);

    const productTestSkill = manager.getSkill('xiaoba-cli-product-test');
    assert.ok(productTestSkill);
    assert.equal(productTestSkill.metadata.userInvocable, true);
    assert.equal(productTestSkill.metadata.autoInvocable, true);
    assert.match(productTestSkill.content, /XiaoBa-CLI product test candidate traces/);
    assert.match(productTestSkill.content, /user_trace_run/);
  });

  test('role exposes only read/search/skill helpers plus UserCat trace runner', async () => {
    const userTools = getRoleSpecificToolsForRole('user-cat');
    assert.deepEqual(userTools.map(tool => tool.definition.name), ['user_trace_run']);
    assert.equal(await startRoleRuntimeServices({ workingDirectory: process.cwd() }), null);

    const manager = createRoleAwareToolManager(process.cwd(), {}, 'user-cat');
    const toolNames = manager.getToolDefinitions().map(tool => tool.name).sort();

    assert.ok(toolNames.includes('user_trace_run'));
    assert.ok(toolNames.includes('read_file'));
    assert.ok(toolNames.includes('grep'));
    assert.ok(toolNames.includes('glob'));
    assert.ok(toolNames.includes('skill'));
    assert.ok(!toolNames.includes('write_file'));
    assert.ok(!toolNames.includes('edit_file'));
    assert.ok(!toolNames.includes('execute_shell'));
    assert.ok(!toolNames.includes('spawn_subagent'));
    assert.ok(!toolNames.includes('check_subagent'));
    assert.ok(!toolNames.includes('reviewer_eval_prepare'));
    assert.ok(!toolNames.includes('reviewer_xiaoba_cli_e2e'));
    assert.ok(!toolNames.includes('reviewer_module_test'));
    assert.ok(!toolNames.includes('engineer_task_run'));
    assert.ok(!toolNames.includes('codex_job_start'));
    assert.ok(!toolNames.includes('feishu_message_send_confirmed'));
  });
});
