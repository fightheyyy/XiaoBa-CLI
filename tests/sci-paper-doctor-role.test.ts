import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PromptManager } from '../src/utils/prompt-manager';
import { RoleResolver } from '../src/utils/role-resolver';
import { SkillManager } from '../src/skills/skill-manager';

describe('SciPaperDoctor role assets', () => {
  test('role.json 应存在且可解析', () => {
    const rolePath = path.join(process.cwd(), 'roles', 'sci-paper-doctor', 'role.json');
    assert.ok(fs.existsSync(rolePath));

    const config = JSON.parse(fs.readFileSync(rolePath, 'utf-8'));
    assert.strictEqual(config.name, 'sci-paper-doctor');
    assert.strictEqual(config.displayName, 'SciPaperDoctor');
    assert.strictEqual(config.promptFile, 'sci-paper-doctor-system-prompt.md');
  });

  test('PromptManager 能加载 SciPaperDoctor prompt', async () => {
    RoleResolver.activateRole('sci-paper-doctor');

    const prompt = await PromptManager.buildSystemPrompt();

    assert.match(prompt, /博士小八|SciPaperDoctor/);
    assert.match(prompt, /科研论文交付流程/);
    assert.match(prompt, /当前角色：SciPaperDoctor/);

    RoleResolver.clearActiveRole();
  });

  test('SkillManager 能加载 SciPaperDoctor 首批 skills', async () => {
    RoleResolver.activateRole('sci-paper-doctor');

    const manager = new SkillManager();
    await manager.loadSkills();

    for (const skillName of [
      'paper-reading-doctor',
      'paper-outline-doctor',
      'experiment-result-auditor',
      'manuscript-result-sync',
      'latex-compile-doctor',
      'experiment-runner-doctor',
      'reviewer-response-doctor',
    ]) {
      assert.ok(manager.getSkill(skillName), `${skillName} should be loaded`);
    }

    RoleResolver.clearActiveRole();
  });
});
