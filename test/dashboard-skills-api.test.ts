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

    writeFile(path.join(testRoot, 'skills', 'sub-agent', 'SKILL.md'), `---
name: "sub-agent"
description: "Legacy sub-agent skill wrapper"
aliases:
  - subagent
user-invocable: false
auto-invocable: false
---

Legacy sub-agent wrapper.
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
    assert.strictEqual((await enableResponse.json() as { status: string }).status, 'candidate');
    assert.strictEqual(fs.existsSync(disabledPath), false);
    assert.strictEqual(fs.existsSync(enabledPath), true);
    assert.match(fs.readFileSync(enabledPath, 'utf-8'), /status: candidate/);

    const restoredResponse = await fetch(`${baseUrl}/api/skills-all`);
    assert.strictEqual(restoredResponse.status, 200);
    const restoredSkills = await restoredResponse.json() as Array<{ name: string; enabled: boolean; status: string }>;
    const restored = restoredSkills.find(skill => skill.name === 'officecli-docx');
    assert.ok(restored);
    assert.strictEqual(restored.enabled, true);
    assert.strictEqual(restored.status, 'candidate');
  });

  test('hides migrated sub-agent skill wrappers but allows direct cleanup', async () => {
    const legacyPath = path.join(testRoot, 'skills', 'sub-agent', 'SKILL.md');

    const listResponse = await fetch(`${baseUrl}/api/skills-all`);
    assert.strictEqual(listResponse.status, 200);
    const skills = await listResponse.json() as Array<{ name: string }>;
    assert.strictEqual(skills.some(skill => skill.name === 'sub-agent'), false);

    const deleteResponse = await fetch(`${baseUrl}/api/skills/sub-agent`, { method: 'DELETE' });
    assert.strictEqual(deleteResponse.status, 200);
    assert.strictEqual(fs.existsSync(legacyPath), false);
  });

  test('shows capability status and changes Skill status without renaming the source file', async () => {
    const candidatePath = path.join(testRoot, 'skills', 'candidate-skill', 'SKILL.md');
    const blockedPath = path.join(testRoot, 'skills', 'blocked-skill', 'SKILL.md');
    writeFile(candidatePath, `---
name: candidate-skill
description: Candidate skill
status: candidate
---

Candidate.
`);
    writeFile(blockedPath, `---
name: blocked-skill
description: Blocked skill
status: blocked
---

Blocked.
`);

    const listResponse = await fetch(`${baseUrl}/api/skills-all`);
    assert.strictEqual(listResponse.status, 200);
    const skills = await listResponse.json() as Array<{ name: string; status: string; enabled: boolean }>;
    assert.deepStrictEqual(
      skills.filter(skill => ['candidate-skill', 'blocked-skill'].includes(skill.name))
        .map(skill => [skill.name, skill.status, skill.enabled])
        .sort(),
      [
        ['blocked-skill', 'blocked', false],
        ['candidate-skill', 'candidate', true],
      ],
    );

    const disable = await fetch(`${baseUrl}/api/skills/candidate-skill/disable`, { method: 'POST' });
    assert.strictEqual(disable.status, 200);
    assert.strictEqual(fs.existsSync(candidatePath), true);
    assert.match(fs.readFileSync(candidatePath, 'utf-8'), /status: blocked/);
    assert.strictEqual(fs.existsSync(`${candidatePath}.disabled`), false);

    const rejectedPromotion = await fetch(`${baseUrl}/api/skills/candidate-skill/promote`, { method: 'POST' });
    assert.strictEqual(rejectedPromotion.status, 409);
    assert.match(fs.readFileSync(candidatePath, 'utf-8'), /status: blocked/);

    const enable = await fetch(`${baseUrl}/api/skills/candidate-skill/enable`, { method: 'POST' });
    assert.strictEqual(enable.status, 200);
    assert.strictEqual((await enable.json() as { status: string }).status, 'candidate');
    assert.match(fs.readFileSync(candidatePath, 'utf-8'), /status: candidate/);

    const promote = await fetch(`${baseUrl}/api/skills/candidate-skill/promote`, { method: 'POST' });
    assert.strictEqual(promote.status, 200);
    assert.strictEqual((await promote.json() as { status: string }).status, 'active');
    assert.match(fs.readFileSync(candidatePath, 'utf-8'), /status: active/);

    const unblock = await fetch(`${baseUrl}/api/skills/blocked-skill/unblock`, { method: 'POST' });
    assert.strictEqual(unblock.status, 200);
    assert.strictEqual((await unblock.json() as { status: string }).status, 'candidate');
    assert.match(fs.readFileSync(blockedPath, 'utf-8'), /status: candidate/);
  });

  test('shows candidate and blocked roles in management while refusing blocked activation', async () => {
    writeFile(path.join(testRoot, 'roles', 'candidate-cat', 'role.json'), JSON.stringify({
      name: 'candidate-cat',
      displayName: 'CandidateCat',
      status: 'candidate',
    }, null, 2));
    writeFile(path.join(testRoot, 'roles', 'blocked-cat', 'role.json'), JSON.stringify({
      name: 'blocked-cat',
      displayName: 'BlockedCat',
      status: 'blocked',
    }, null, 2));

    const listResponse = await fetch(`${baseUrl}/api/roles`);
    assert.strictEqual(listResponse.status, 200);
    const roles = await listResponse.json() as { roles: Array<{ name: string; status: string }> };
    assert.strictEqual(roles.roles.find(role => role.name === 'candidate-cat')?.status, 'candidate');
    assert.strictEqual(roles.roles.find(role => role.name === 'blocked-cat')?.status, 'blocked');

    const blocked = await fetch(`${baseUrl}/api/roles/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'blocked-cat' }),
    });
    assert.strictEqual(blocked.status, 400);

    const rejectedPromotion = await fetch(`${baseUrl}/api/roles/blocked-cat/promote`, { method: 'POST' });
    assert.strictEqual(rejectedPromotion.status, 409);

    const unblock = await fetch(`${baseUrl}/api/roles/blocked-cat/unblock`, { method: 'POST' });
    assert.strictEqual(unblock.status, 200);
    assert.strictEqual((await unblock.json() as { status: string }).status, 'candidate');
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(testRoot, 'roles', 'blocked-cat', 'role.json'), 'utf-8')).status,
      'candidate',
    );

    const candidate = await fetch(`${baseUrl}/api/roles/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'candidate-cat' }),
    });
    assert.strictEqual(candidate.status, 200);
    assert.strictEqual(RoleResolver.getActiveRoleName(), 'candidate-cat');

    const blockCandidate = await fetch(`${baseUrl}/api/roles/candidate-cat/block`, { method: 'POST' });
    assert.strictEqual(blockCandidate.status, 200);
    assert.strictEqual((await blockCandidate.json() as { status: string }).status, 'blocked');
    assert.strictEqual(RoleResolver.getActiveRoleName(), undefined);

    const restoreCandidate = await fetch(`${baseUrl}/api/roles/candidate-cat/unblock`, { method: 'POST' });
    assert.strictEqual(restoreCandidate.status, 200);
    assert.strictEqual((await restoreCandidate.json() as { status: string }).status, 'candidate');

    const promoteCandidate = await fetch(`${baseUrl}/api/roles/candidate-cat/promote`, { method: 'POST' });
    assert.strictEqual(promoteCandidate.status, 200);
    assert.strictEqual((await promoteCandidate.json() as { status: string }).status, 'active');
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(testRoot, 'roles', 'candidate-cat', 'role.json'), 'utf-8')).status,
      'active',
    );
  });

  test('deletes an installed role and clears the active role', async () => {
    const rolePath = path.join(testRoot, 'roles', 'engineer-cat');

    const deleteResponse = await fetch(`${baseUrl}/api/roles/engineer-cat`, { method: 'DELETE' });
    assert.strictEqual(deleteResponse.status, 200);
    const result = await deleteResponse.json() as { ok: boolean; active: string | null };
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.active, null);
    assert.strictEqual(fs.existsSync(rolePath), false);
    assert.strictEqual(RoleResolver.getActiveRoleName(), undefined);

    const listResponse = await fetch(`${baseUrl}/api/roles`);
    assert.strictEqual(listResponse.status, 200);
    const roles = await listResponse.json() as { roles: Array<{ name: string }> };
    assert.strictEqual(roles.roles.some(role => role.name === 'engineer-cat'), false);
  });
});
