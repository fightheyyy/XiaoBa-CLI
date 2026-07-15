import { after, afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RoleManager } from '../src/roles/role-manager';
import { RoleResolver } from '../src/utils/role-resolver';
import { createRoleAwareToolManager } from '../src/bootstrap/tool-manager';
import { getRoleSpecificToolsForRole } from '../src/roles/runtime-role-registry';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;
const originalRolesRoot = process.env.XIAOBA_ROLES_ROOT;

function writeRole(root: string, roleName: string, config: Record<string, unknown>): void {
  const roleDir = path.join(root, 'roles', roleName);
  fs.mkdirSync(roleDir, { recursive: true });
  fs.writeFileSync(path.join(roleDir, 'role.json'), JSON.stringify(config, null, 2), 'utf-8');
}

describe('RoleManager', () => {
  let testRoot = '';

  beforeEach(() => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-role-manager-'));
    process.chdir(testRoot);
    delete process.env.XIAOBA_ROLES_ROOT;

    writeRole(testRoot, 'engineer-cat', {
      name: 'engineer-cat',
      displayName: 'EngineerCat',
      aliases: ['engineer'],
      description: 'Implementation role',
    });
    writeRole(testRoot, 'reviewer-cat', {
      name: 'reviewer-cat',
      displayName: 'ReviewerCat',
      description: 'Review role',
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  after(() => {
    process.chdir(originalCwd);
    restoreEnv('XIAOBA_ROLE', originalRole);
    restoreEnv('CURRENT_ROLE', originalCurrentRole);
    restoreEnv('CURRENT_ROLE_DISPLAY_NAME', originalCurrentRoleDisplayName);
    restoreEnv('XIAOBA_ROLES_ROOT', originalRolesRoot);
  });

  test('lists role metadata and resolves aliases', () => {
    const roles = RoleManager.listRoles();
    assert.deepStrictEqual(roles.map(role => role.name), ['engineer-cat', 'reviewer-cat']);

    const engineer = RoleManager.getRole('engineer');
    assert.ok(engineer);
    assert.strictEqual(engineer.name, 'engineer-cat');
    assert.strictEqual(engineer.displayName, 'EngineerCat');
    assert.strictEqual(engineer.description, 'Implementation role');
  });

  test('removes a role and clears active role when needed', () => {
    RoleResolver.activateRole('engineer');
    assert.strictEqual(RoleResolver.getActiveRoleName(), 'engineer-cat');

    const result = RoleManager.removeRole('engineer');
    assert.strictEqual(result.name, 'engineer-cat');
    assert.strictEqual(result.wasActive, true);
    assert.strictEqual(fs.existsSync(path.join(testRoot, 'roles', 'engineer-cat')), false);
    assert.strictEqual(RoleResolver.getActiveRoleName(), undefined);
    assert.deepStrictEqual(RoleManager.listRoles().map(role => role.name), ['reviewer-cat']);
  });

  test('refuses to remove the base role', () => {
    assert.throws(
      () => RoleManager.removeRole('base'),
      /Base role cannot be removed/,
    );
  });

  test('discovers only active roles while allowing exact candidate selection', () => {
    writeRole(testRoot, 'candidate-cat', {
      name: 'candidate-cat',
      displayName: 'CandidateCat',
      aliases: ['candidate-alias'],
      status: 'candidate',
    });
    writeRole(testRoot, 'blocked-cat', {
      name: 'blocked-cat',
      displayName: 'BlockedCat',
      aliases: ['blocked-alias'],
      status: 'blocked',
    });

    assert.deepStrictEqual(RoleResolver.listAvailableRoles(), ['engineer-cat', 'reviewer-cat']);
    assert.deepStrictEqual(
      RoleResolver.listManagedRoles(),
      ['blocked-cat', 'candidate-cat', 'engineer-cat', 'reviewer-cat'],
    );
    assert.strictEqual(RoleResolver.resolveRoleDirectoryName('candidate-cat'), 'candidate-cat');
    assert.strictEqual(RoleResolver.resolveRoleDirectoryName('candidate-alias'), undefined);
    assert.strictEqual(RoleResolver.resolveRoleDirectoryName('blocked-cat'), undefined);
    assert.strictEqual(RoleResolver.resolveRoleDirectoryName('blocked-alias'), undefined);

    RoleResolver.activateRole('candidate-cat');
    assert.strictEqual(RoleResolver.getActiveRoleName(), 'candidate-cat');
    assert.throws(() => RoleResolver.activateRole('blocked-cat'), /未找到角色/);

    const summaries = RoleManager.listRoles();
    assert.strictEqual(summaries.find(role => role.name === 'engineer-cat')?.status, 'active');
    assert.strictEqual(summaries.find(role => role.name === 'candidate-cat')?.status, 'candidate');
    assert.strictEqual(summaries.find(role => role.name === 'blocked-cat')?.status, 'blocked');
    assert.strictEqual(RoleManager.getRole('blocked-alias')?.name, 'blocked-cat');
  });

  test('does not let raw role names bypass blocked resolution', () => {
    writeRole(testRoot, 'engineer-cat', {
      name: 'engineer-cat',
      displayName: 'EngineerCat',
      status: 'blocked',
    });

    assert.strictEqual(RoleResolver.resolveRoleDirectoryName('engineer-cat'), undefined);
    assert.throws(
      () => createRoleAwareToolManager(testRoot, { roleName: 'engineer-cat' }, 'engineer-cat'),
      /unavailable or blocked/,
    );
    assert.deepStrictEqual(getRoleSpecificToolsForRole('engineer-cat'), []);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
