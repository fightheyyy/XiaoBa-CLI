import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { SkillManager } from '../src/skills/skill-manager';
import { ToolManager } from '../src/tools/tool-manager';
import { createSubAgentToolManager } from '../src/core/sub-agent-session';

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

  test('sub-agents inherit role-specific runtime tools', () => {
    const engineerTools = createSubAgentToolManager(process.cwd(), 'test-engineer', 'engineer-cat');
    assert.ok(engineerTools.getTool('engineer_task_run'));
    assert.ok(engineerTools.getTool('codex_job_status'));

    const inspectorTools = createSubAgentToolManager(process.cwd(), 'test-inspector', 'inspector-cat');
    assert.ok(inspectorTools.getTool('run_pending_log_batch'));
  });
});
