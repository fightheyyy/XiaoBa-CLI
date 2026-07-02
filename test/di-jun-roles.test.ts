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

interface DiJunCase {
  roleName: string;
  displayName: string;
  promptFile: string;
  alias: string;
  promptMarkers: RegExp[];
  corpusMarkers: RegExp[];
}

const roleCases: DiJunCase[] = [
  {
    roleName: 'huang-sheng-di-jun',
    displayName: 'HuangShengDiJun',
    promptFile: 'huang-sheng-di-jun-system-prompt.md',
    alias: 'waywardzz',
    promptMarkers: [
      /你不是 Waywardzz \/ Wayward \/ 黄任行本人/,
      /fan-style parody role/,
      /公式舒服/,
      /阿木木先别哭/,
      /不说“我是 Waywardzz/,
    ],
    corpusMarkers: [
      /Way延/,
      /老东西，该爆金币了/,
      /公式舒服/,
    ],
  },
  {
    roleName: 'xuan-sheng-di-jun',
    displayName: 'XuanShengDiJun',
    promptFile: 'xuan-sheng-di-jun-system-prompt.md',
    alias: 'last炫神',
    promptMarkers: [
      /你不是 Last炫神 \/ 许昊龙本人/,
      /fan-style parody role/,
      /有一说一，确实/,
      /穿甲王来了/,
      /不说“我是 Last炫神/,
    ],
    corpusMarkers: [
      /强者就是要羞辱弱者/,
      /扫腿！护盾！晕眩反杀！天秀！/,
      /芜湖/,
    ],
  },
];

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

describe('DiJun prompt-only parody roles', () => {
  beforeEach(() => {
    RoleResolver.clearActiveRole();
  });

  after(() => {
    restoreEnv();
  });

  for (const roleCase of roleCases) {
    test(`${roleCase.roleName} assets, alias, and prompt boundary`, async () => {
      const roleDir = path.join(process.cwd(), 'roles', roleCase.roleName);
      const configPath = path.join(roleDir, 'role.json');
      assert.ok(fs.existsSync(configPath));

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.equal(config.name, roleCase.roleName);
      assert.equal(config.displayName, roleCase.displayName);
      assert.equal(config.promptFile, roleCase.promptFile);
      assert.equal(config.inheritBaseSkills, false);
      assert.equal(config.inheritBaseTools, false);
      assert.deepEqual(config.baseToolAllowlist, []);
      assert.equal(config.metadata.personaType, 'fan-style-parody');
      assert.ok(config.aliases.includes(roleCase.alias));

      RoleResolver.activateRole(roleCase.alias);
      assert.equal(RoleResolver.getActiveRoleName(), roleCase.roleName);
      assert.equal(process.env.CURRENT_ROLE_DISPLAY_NAME, roleCase.displayName);

      const prompt = await PromptManager.buildSystemPrompt({ roleName: roleCase.roleName });
      for (const marker of roleCase.promptMarkers) {
        assert.match(prompt, marker);
      }
      assert.match(prompt, new RegExp(`当前角色：${roleCase.displayName}`));

      const corpus = fs.readFileSync(path.join(roleDir, 'references', 'voice-corpus.md'), 'utf-8');
      for (const marker of roleCase.corpusMarkers) {
        assert.match(corpus, marker);
      }
    });

    test(`${roleCase.roleName} keeps prompt-only no-tool policy`, async () => {
      const skillManager = new SkillManager(roleCase.roleName);
      await skillManager.loadSkills();
      assert.deepEqual(skillManager.getAllSkills().map(skill => skill.metadata.name), []);

      assert.deepEqual(getRoleSpecificToolsForRole(roleCase.roleName).map(tool => tool.definition.name), []);
      RoleResolver.activateRole(roleCase.roleName);
      assert.equal(await startRoleRuntimeServices({ workingDirectory: process.cwd() }), null);

      const manager = createRoleAwareToolManager(process.cwd(), { surface: 'cli' }, roleCase.roleName);
      assert.deepEqual(manager.getToolDefinitions().map(tool => tool.name), []);
    });
  }
});
