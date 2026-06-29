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
  test('electron package only bundles the five default base skills', () => {
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
  });

  test('electron package only bundles the four core review-loop roles by default', () => {
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
    assert.strictEqual(bundledRoles.includes('secretary-cat'), false);
    assert.strictEqual(bundledRoles.includes('guide'), false);
  });
});
