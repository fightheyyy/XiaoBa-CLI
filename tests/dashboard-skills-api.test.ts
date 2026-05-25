import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createApiRouter } from '../src/dashboard/routes/api';
import { ServiceManager } from '../src/dashboard/service-manager';
import { MessageSessionManager } from '../src/core/message-session-manager';
import { RoleResolver } from '../src/utils/role-resolver';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

async function listen(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server: http.Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}

describe('Dashboard skills API disabled skill lifecycle', () => {
  let testRoot = '';
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-dashboard-skills-'));
    process.chdir(testRoot);

    writeFile(path.join(testRoot, 'roles', 'engineer-cat', 'role.json'), JSON.stringify({
      name: 'engineer-cat',
      displayName: 'EngineerCat',
      inheritBaseSkills: true,
    }, null, 2));
    RoleResolver.activateRole('engineer-cat');

    writeFile(path.join(testRoot, 'skills', 'OfficeCLI', 'officecli-docx', 'SKILL.md.disabled'), `---
name: "officecli-docx"
description: "Docx skill: can recover from Dashboard"
aliases:
  - docx-edit
user-invocable: false
auto-invocable: false
max-turns: 3
---

Disabled content.
`);

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', createApiRouter(new ServiceManager(testRoot)));
    const listening = await listen(app);
    server = listening.server;
    baseUrl = listening.baseUrl;
  });

  afterEach(async () => {
    await closeServer(server);
    server = null;
    await MessageSessionManager.getManager('pet')?.destroy();
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    restoreEnvValue('XIAOBA_ROLE', originalRole);
    restoreEnvValue('CURRENT_ROLE', originalCurrentRole);
    restoreEnvValue('CURRENT_ROLE_DISPLAY_NAME', originalCurrentRoleDisplayName);
  });

  test('lists and restores disabled base skills while a role is active', async () => {
    const disabledPath = path.join(testRoot, 'skills', 'OfficeCLI', 'officecli-docx', 'SKILL.md.disabled');
    const enabledPath = path.join(testRoot, 'skills', 'OfficeCLI', 'officecli-docx', 'SKILL.md');

    const listResponse = await fetch(`${baseUrl}/api/skills-all`);
    assert.strictEqual(listResponse.status, 200);
    const skills = await listResponse.json() as Array<{
      name: string;
      aliases: string[];
      description: string;
      enabled: boolean;
      userInvocable: boolean;
      autoInvocable: boolean;
      maxTurns: number | null;
    }>;
    const disabled = skills.find(skill => skill.name === 'officecli-docx');
    assert.ok(disabled);
    assert.deepStrictEqual(disabled.aliases, ['docx-edit']);
    assert.strictEqual(disabled.enabled, false);
    assert.strictEqual(disabled.userInvocable, false);
    assert.strictEqual(disabled.autoInvocable, false);
    assert.strictEqual(disabled.maxTurns, 3);

    const enableResponse = await fetch(`${baseUrl}/api/skills/officecli-docx/enable`, { method: 'POST' });
    assert.strictEqual(enableResponse.status, 200);
    assert.strictEqual(fs.existsSync(disabledPath), false);
    assert.strictEqual(fs.existsSync(enabledPath), true);

    const restoredResponse = await fetch(`${baseUrl}/api/skills-all`);
    assert.strictEqual(restoredResponse.status, 200);
    const restoredSkills = await restoredResponse.json() as Array<{ name: string; enabled: boolean }>;
    const restored = restoredSkills.find(skill => skill.name === 'officecli-docx');
    assert.ok(restored);
    assert.strictEqual(restored.enabled, true);
  });
});
