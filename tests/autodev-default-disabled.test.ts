import { afterEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import { startRoleRuntimeServices } from '../src/roles/runtime-role-registry';
import { isAutoDevConfigured, isAutoDevEnabled, isAutoDevRuntimeEnabled } from '../src/utils/autodev-config';
import { RoleResolver } from '../src/utils/role-resolver';

describe('AutoDev default disabled', () => {
  const originalEnv = {
    autodevEnabled: process.env.AUTODEV_ENABLED,
    xiaobaAutodevEnabled: process.env.XIAOBA_AUTODEV_ENABLED,
    autoDevServerUrl: process.env.AUTODEV_SERVER_URL,
    xiaobaAutoDevServerUrl: process.env.XIAOBA_AUTODEV_SERVER_URL,
    xiaobaRole: process.env.XIAOBA_ROLE,
    currentRole: process.env.CURRENT_ROLE,
    currentRoleDisplayName: process.env.CURRENT_ROLE_DISPLAY_NAME,
  };

  afterEach(() => {
    restoreEnv('AUTODEV_ENABLED', originalEnv.autodevEnabled);
    restoreEnv('XIAOBA_AUTODEV_ENABLED', originalEnv.xiaobaAutodevEnabled);
    restoreEnv('AUTODEV_SERVER_URL', originalEnv.autoDevServerUrl);
    restoreEnv('XIAOBA_AUTODEV_SERVER_URL', originalEnv.xiaobaAutoDevServerUrl);
    restoreEnv('XIAOBA_ROLE', originalEnv.xiaobaRole);
    restoreEnv('CURRENT_ROLE', originalEnv.currentRole);
    restoreEnv('CURRENT_ROLE_DISPLAY_NAME', originalEnv.currentRoleDisplayName);
  });

  test('AutoDev runtime requires explicit enable flag in addition to server URL', () => {
    process.env.AUTODEV_SERVER_URL = 'http://127.0.0.1:9';
    delete process.env.AUTODEV_ENABLED;
    delete process.env.XIAOBA_AUTODEV_ENABLED;

    assert.strictEqual(isAutoDevConfigured(), true);
    assert.strictEqual(isAutoDevEnabled(), false);
    assert.strictEqual(isAutoDevRuntimeEnabled(), false);

    process.env.AUTODEV_ENABLED = 'true';
    assert.strictEqual(isAutoDevEnabled(), true);
    assert.strictEqual(isAutoDevRuntimeEnabled(), true);
  });

  test('role runtime does not start AutoDev worker by default', async () => {
    process.env.AUTODEV_SERVER_URL = 'http://127.0.0.1:9';
    delete process.env.AUTODEV_ENABLED;
    delete process.env.XIAOBA_AUTODEV_ENABLED;
    RoleResolver.activateRole('engineer-cat');

    const support = await startRoleRuntimeServices({ workingDirectory: process.cwd() });

    assert.strictEqual(support, null);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
