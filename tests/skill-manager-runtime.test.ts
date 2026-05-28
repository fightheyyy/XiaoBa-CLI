import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { SkillManager } from '../src/skills/skill-manager';
import { ToolManager } from '../src/tools/tool-manager';

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
});
