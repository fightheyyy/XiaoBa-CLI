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
    for (const controlTool of ['spawn_subagent', 'check_subagent', 'stop_subagent', 'resume_subagent', 'skill']) {
      assert.strictEqual(engineerToolNames.includes(controlTool), false, `${controlTool} should be hidden inside sub-agents`);
    }

    const inspectorTools = createSubAgentToolExecutor(process.cwd(), 'test-inspector', 'inspector-cat');
    const inspectorToolNames = inspectorTools.getToolDefinitions().map(tool => tool.name);
    assert.ok(inspectorToolNames.includes('run_pending_log_batch'));
  });
});
