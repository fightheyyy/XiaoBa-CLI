import { after, afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolManager } from '../src/tools/tool-manager';
import { RoleResolver } from '../src/utils/role-resolver';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

describe('ToolManager role-specific tools', () => {
  let testRoot: string;

  beforeEach(() => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-tool-role-'));
    fs.mkdirSync(path.join(testRoot, 'roles', 'InspectorCat'), { recursive: true });
    fs.writeFileSync(
      path.join(testRoot, 'roles', 'InspectorCat', 'role.json'),
      JSON.stringify({ name: 'inspector-cat', displayName: 'InspectorCat' }, null, 2),
      'utf-8',
    );
    process.chdir(testRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  after(() => {
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
  });

  test('默认角色不注册 Inspector 专属工具', () => {
    const manager = new ToolManager();
    assert.strictEqual(manager.getTool('analyze_log'), undefined);
  });

  test('inspector-cat 角色注册 analyze_log', () => {
    RoleResolver.activateRole('inspector-cat');
    const manager = new ToolManager();
    assert.ok(manager.getTool('analyze_log'));
  });
});
