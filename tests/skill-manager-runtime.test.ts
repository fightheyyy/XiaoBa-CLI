import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { SkillManager } from '../src/skills/skill-manager';
import { ToolManager } from '../src/tools/tool-manager';
import { createSubAgentToolExecutor } from '../src/core/sub-agent-session';

describe('SkillManager runtime base skills', () => {
  test('base runtime excludes OfficeCLI and sub-agent skill wrappers', async () => {
    const manager = new SkillManager();
    await manager.loadSkills();

    const names = manager.getAllSkills().map(skill => skill.metadata.name).sort();

    assert.deepStrictEqual(names, [
      'agent-browser',
      'background-task-runner',
      'remember',
      'role-publish',
      'self-evolution',
      'skill-publish',
      'vision-analysis',
      'webcli',
    ]);
    assert.strictEqual(manager.getSkill('officecli-docx'), undefined);
    assert.strictEqual(manager.getSkill('officecli-pptx'), undefined);
    assert.strictEqual(manager.getSkill('officecli-xlsx'), undefined);
    assert.strictEqual(manager.getSkill('sub-agent'), undefined);

    const fallback = manager.getSkill('background-task-runner');
    assert.ok(fallback, 'background-task-runner should be available for spawn_subagent fallback use');
    assert.strictEqual(fallback.metadata.userInvocable, false);
    assert.strictEqual(fallback.metadata.autoInvocable, false);
    assert.strictEqual(manager.getSkill('general-background-task')?.metadata.name, 'background-task-runner');
  });

  test('sub-agent capabilities are default runtime tools', () => {
    const manager = new ToolManager();

    for (const toolName of [
      'spawn_subagent',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'ask_parent',
    ]) {
      assert.ok(manager.getTool(toolName), `${toolName} should be registered as a runtime tool`);
    }
  });

  test('sub-agents inherit role-specific runtime tools without main-session control tools', () => {
    const engineerTools = createSubAgentToolExecutor(process.cwd(), 'test-engineer', 'engineer-cat');
    const engineerToolNames = engineerTools.getToolDefinitions().map(tool => tool.name);
    assert.ok(engineerToolNames.includes('engineer_task_run'));
    assert.ok(engineerToolNames.includes('codex_job_status'));
    assert.ok(engineerToolNames.includes('ask_parent'));
    for (const hiddenTool of [
      'spawn_subagent',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'skill',
      'send_text',
      'send_file',
    ]) {
      assert.strictEqual(engineerToolNames.includes(hiddenTool), false, `${hiddenTool} should be hidden inside sub-agents`);
    }

    const inspectorTools = createSubAgentToolExecutor(process.cwd(), 'test-inspector', 'inspector-cat');
    const inspectorToolNames = inspectorTools.getToolDefinitions().map(tool => tool.name);
    assert.ok(inspectorToolNames.includes('run_pending_log_batch'));
  });
});
