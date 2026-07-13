import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_BUNDLED_ROLES } from '../src/roles/role-manager';
import { DEFAULT_BUNDLED_BASE_SKILLS } from '../src/skills/skill-manager';

function getBuildFiles(): string[] {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
  return packageJson.build.files as string[];
}

describe('default packaged policy assets', () => {
  test('electron package only bundles the four default base skills', () => {
    const files = getBuildFiles();
    const bundledSkills = files
      .map(file => {
        const match = file.match(/^skills\/([^/]+)\/\*\*\/\*$/);
        return match?.[1];
      })
      .filter((skill): skill is string => Boolean(skill))
      .sort();

    assert.deepStrictEqual(bundledSkills, [...DEFAULT_BUNDLED_BASE_SKILLS].sort());
    assert.ok(files.includes('skills/README.md'));
    assert.strictEqual(bundledSkills.includes('OfficeCLI'), false);
    assert.strictEqual(bundledSkills.includes('WebCLI'), false);
    assert.strictEqual(bundledSkills.includes('vision-analysis'), false);
    assert.strictEqual(bundledSkills.includes('agent-browser'), false);
  });

  test('electron package bundles the seven default roles', () => {
    const files = getBuildFiles();
    const bundledRoles = files
      .map(file => {
        const match = file.match(/^roles\/([^/]+)\/\*\*\/\*$/);
        return match?.[1];
      })
      .filter((role): role is string => Boolean(role))
      .sort();

    assert.deepStrictEqual(bundledRoles, [...DEFAULT_BUNDLED_ROLES].sort());
    assert.ok(files.includes('roles/README.md'));
    assert.strictEqual(bundledRoles.includes('researcher-cat'), false);
    assert.strictEqual(bundledRoles.includes('router-cat'), false);
    assert.strictEqual(bundledRoles.includes('secretary-cat'), true);
    assert.strictEqual(bundledRoles.includes('guide'), false);
    assert.ok(bundledRoles.includes('browser-cat'));
    assert.ok(bundledRoles.includes('gui-cat'));
    assert.ok(bundledRoles.includes('secretary-cat'));
  });

  test('electron startup sync includes takeover roles and narrowly migrates exact bundled assets', () => {
    const mainSource = fs.readFileSync(
      path.join(process.cwd(), 'desktop', 'electron', 'main.js'),
      'utf-8',
    );

    assert.match(mainSource, /DEFAULT_BUNDLED_ROLES[^\n]+browser-cat[^\n]+gui-cat[^\n]+secretary-cat/);
    assert.match(mainSource, /RETIRED_AGENT_BROWSER_SKILL_SHA256S/);
    assert.match(mainSource, /26f30428a5cff69f396e821cb51060db1f13c7ec66473268b3731001ea63cd93/);
    assert.match(mainSource, /fs\.rmSync\(retiredBrowserSkillDir/);
    assert.match(mainSource, /LEGACY_ROLE_CONFIG_SHA256/);
    assert.match(mainSource, /petId: bundledRoleConfig\.metadata\.petId/);
    assert.match(mainSource, /createHash\('sha256'\)/);
    assert.match(mainSource, /migration-backups/);
    assert.doesNotMatch(mainSource, /includes\('npx agent-browser'\)/);
    assert.doesNotMatch(mainSource, /shouldMigrateLegacyBrowserSkill/);
  });
});
