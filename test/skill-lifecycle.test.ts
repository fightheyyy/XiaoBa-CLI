import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillManager } from '../src/skills/skill-manager';

const originalSkillsRoot = process.env.XIAOBA_SKILLS_ROOT;
const originalArena = process.env.XIAOBA_ARENA;

function writeSkill(
  root: string,
  name: string,
  status?: 'candidate' | 'active' | 'blocked',
  aliases: string[] = [],
): void {
  const skillDir = path.join(root, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${name} lifecycle fixture`,
    ...(status ? [`status: ${status}`] : []),
    ...(aliases.length ? ['aliases:', ...aliases.map(alias => `  - ${alias}`)] : []),
    '---',
    '',
    `Use ${name}.`,
    '',
  ].join('\n'), 'utf-8');
}

describe('Skill lifecycle gate', () => {
  let testRoot = '';
  let skillsRoot = '';

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-skill-lifecycle-'));
    skillsRoot = path.join(testRoot, 'skills');
    process.env.XIAOBA_SKILLS_ROOT = skillsRoot;
    delete process.env.XIAOBA_ARENA;

    writeSkill(skillsRoot, 'legacy-active', undefined, ['legacy']);
    writeSkill(skillsRoot, 'candidate-skill', 'candidate', ['candidate-alias']);
    writeSkill(skillsRoot, 'blocked-skill', 'blocked', ['blocked-alias']);
  });

  afterEach(() => {
    restoreEnv('XIAOBA_SKILLS_ROOT', originalSkillsRoot);
    restoreEnv('XIAOBA_ARENA', originalArena);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('keeps candidate explicit-only and never returns blocked for invocation', async () => {
    const manager = new SkillManager();
    await manager.loadSkills();

    assert.deepStrictEqual(
      manager.getAllManagedSkills().map(skill => skill.metadata.name).sort(),
      ['blocked-skill', 'candidate-skill', 'legacy-active'],
    );
    assert.deepStrictEqual(
      manager.getAllSkills().map(skill => skill.metadata.name).sort(),
      ['candidate-skill', 'legacy-active'],
    );
    assert.deepStrictEqual(
      manager.getUserInvocableSkills().map(skill => skill.metadata.name),
      ['legacy-active'],
    );
    assert.deepStrictEqual(
      manager.getAutoInvocableSkills().map(skill => skill.metadata.name),
      ['legacy-active'],
    );

    assert.strictEqual(manager.getSkill('legacy')?.metadata.status, 'active');
    assert.strictEqual(manager.getSkill('candidate-skill')?.metadata.status, 'candidate');
    assert.strictEqual(manager.getSkill('candidate-alias')?.metadata.status, 'candidate');
    assert.strictEqual(manager.getSkill('blocked-skill'), undefined);
    assert.strictEqual(manager.getSkill('blocked-alias'), undefined);
    assert.strictEqual(manager.getManagedSkill('blocked-skill')?.metadata.status, 'blocked');
  });

  test('makes mounted candidates discoverable only inside the Arena runtime', async () => {
    const manager = new SkillManager();
    await manager.loadSkills();

    process.env.XIAOBA_ARENA = '1';

    assert.deepStrictEqual(
      manager.getUserInvocableSkills().map(skill => skill.metadata.name).sort(),
      ['candidate-skill', 'legacy-active'],
    );
    assert.strictEqual(
      manager.getAutoInvocableSkills().some(skill => skill.metadata.name === 'blocked-skill'),
      false,
    );
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
