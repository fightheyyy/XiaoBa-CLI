import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { PetChannel } from '../src/pet/channel';
import { RoleResolver } from '../src/utils/role-resolver';

const originalCwd = process.cwd();
const originalPetsDir = process.env.XIAOBA_PETS_DIR;
const originalAppRoot = process.env.XIAOBA_APP_ROOT;
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

function writePet(root: string, id: string, displayName: string): void {
  const petDir = path.join(root, 'dashboard', 'pets', id);
  fs.mkdirSync(petDir, { recursive: true });
  fs.writeFileSync(
    path.join(petDir, 'pet.json'),
    JSON.stringify({
      id,
      displayName,
      description: `${displayName} test pet`,
      spritesheetPath: 'spritesheet.webp',
    }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(petDir, 'spritesheet.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]));
}

function writeRole(root: string, name: string, petId: string): void {
  const roleDir = path.join(root, 'roles', name);
  fs.mkdirSync(roleDir, { recursive: true });
  fs.writeFileSync(
    path.join(roleDir, 'role.json'),
    JSON.stringify({
      name,
      displayName: name,
      metadata: { petId },
    }, null, 2),
    'utf-8',
  );
}

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

async function readSse(response: Response): Promise<any[]> {
  const body = await response.text();
  return body
    .split('\n\n')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const line = part.split('\n').find(item => item.startsWith('data: '));
      assert.ok(line, `missing data line in ${part}`);
      return JSON.parse(line.slice(6));
    });
}

async function readSseUntil(response: Response, count: number, timeoutMs = 1200): Promise<any[]> {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: any[] = [];
  let buffer = '';

  while (events.length < count) {
    let timer: NodeJS.Timeout | null = null;
    const read = reader.read();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for ${count} SSE events`)), timeoutMs);
    });
    const { value, done } = await Promise.race([read, timeout]);
    if (timer) clearTimeout(timer);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find(item => item.startsWith('data: '));
      assert.ok(line, `missing data line in ${part}`);
      events.push(JSON.parse(line.slice(6)));
      if (events.length >= count) break;
    }
  }

  await reader.cancel().catch(() => undefined);
  return events;
}

describe('PetChannel', () => {
  let testRoot: string;
  let channel: PetChannel | null = null;
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-pet-'));
    writePet(testRoot, 'alpha-puff', 'Alpha Puff');
    delete process.env.XIAOBA_PETS_DIR;
    process.chdir(testRoot);

    channel = new PetChannel();
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', channel.router);
    const listening = await listen(app);
    server = listening.server;
    baseUrl = listening.baseUrl;
  });

  afterEach(async () => {
    await closeServer(server);
    server = null;
    if (channel) {
      await channel.destroy();
      channel = null;
    }
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    if (typeof originalPetsDir === 'string') {
      process.env.XIAOBA_PETS_DIR = originalPetsDir;
    } else {
      delete process.env.XIAOBA_PETS_DIR;
    }
    if (typeof originalAppRoot === 'string') {
      process.env.XIAOBA_APP_ROOT = originalAppRoot;
    } else {
      delete process.env.XIAOBA_APP_ROOT;
    }
    if (typeof originalRole === 'string') {
      process.env.XIAOBA_ROLE = originalRole;
    } else {
      delete process.env.XIAOBA_ROLE;
    }
    if (typeof originalCurrentRole === 'string') {
      process.env.CURRENT_ROLE = originalCurrentRole;
    } else {
      delete process.env.CURRENT_ROLE;
    }
    if (typeof originalCurrentRoleDisplayName === 'string') {
      process.env.CURRENT_ROLE_DISPLAY_NAME = originalCurrentRoleDisplayName;
    } else {
      delete process.env.CURRENT_ROLE_DISPLAY_NAME;
    }
  });

  test('列出项目内置 pet，并暴露 pet spritesheet URL', async () => {
    const response = await fetch(`${baseUrl}/api/pet/pets`);
    assert.strictEqual(response.status, 200);
    const data = await response.json() as { pets: Array<{ id: string; displayName: string; spriteUrl: string; source: string }> };

    const pet = data.pets.find(item => item.id === 'alpha-puff');
    assert.ok(pet);
    assert.strictEqual(pet!.displayName, 'Alpha Puff');
    assert.strictEqual(pet!.spriteUrl, '/api/pet/pets/alpha-puff/spritesheet');
    assert.strictEqual(pet!.source, 'bundled');
  });

  test('默认 pet 会跟随 active role 的 petId 配置', async () => {
    writePet(testRoot, 'role-puff', 'Role Puff');
    writeRole(testRoot, 'engineer-cat', 'role-puff');
    RoleResolver.activateRole('engineer-cat');

    const response = await fetch(`${baseUrl}/api/pet/pets`);
    assert.strictEqual(response.status, 200);
    const data = await response.json() as { activeRole: string; rolePetId: string; defaultPetId: string };

    assert.strictEqual(data.activeRole, 'engineer-cat');
    assert.strictEqual(data.rolePetId, 'role-puff');
    assert.strictEqual(data.defaultPetId, 'role-puff');

    const wake = await fetch(`${baseUrl}/api/pet/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(wake.status, 200);
    const wakeData = await wake.json() as { petId: string; sessionKey: string };
    assert.strictEqual(wakeData.petId, 'role-puff');
    assert.strictEqual(wakeData.sessionKey, 'pet:role-puff');
  });

  test('spritesheet endpoint 只允许解析到 pet 目录内的资源', async () => {
    const ok = await fetch(`${baseUrl}/api/pet/pets/alpha-puff/spritesheet`);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.headers.get('content-type'), 'image/webp');
    assert.strictEqual(await ok.arrayBuffer().then(buf => buf.byteLength), 4);

    const bad = await fetch(`${baseUrl}/api/pet/pets/..%2Fsecret/spritesheet`);
    assert.strictEqual(bad.status, 404);
  });

  test('Electron cwd 切到 userData 时仍从 XIAOBA_APP_ROOT 读取内置 pet', async () => {
    await closeServer(server);
    server = null;
    if (channel) {
      await channel.destroy();
      channel = null;
    }

    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-pet-app-root-'));
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-pet-user-data-'));
    writePet(appRoot, 'electron-puff', 'Electron Puff');
    process.env.XIAOBA_APP_ROOT = appRoot;
    process.chdir(userData);

    channel = new PetChannel();
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', channel.router);
    const listening = await listen(app);
    server = listening.server;
    baseUrl = listening.baseUrl;

    const petsResponse = await fetch(`${baseUrl}/api/pet/pets`);
    assert.strictEqual(petsResponse.status, 200);
    const petsData = await petsResponse.json() as { pets: Array<{ id: string; source: string }> };
    assert.ok(petsData.pets.some(pet => pet.id === 'electron-puff' && pet.source === 'bundled'));

    const spriteResponse = await fetch(`${baseUrl}/api/pet/pets/electron-puff/spritesheet`);
    assert.strictEqual(spriteResponse.status, 200);
    assert.strictEqual(await spriteResponse.arrayBuffer().then(buf => buf.byteLength), 4);

    process.chdir(testRoot);
    fs.rmSync(appRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('wake 为 pet 创建独立 pet session key', async () => {
    const response = await fetch(`${baseUrl}/api/pet/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId: 'alpha-puff' }),
    });
    assert.strictEqual(response.status, 200);
    const data = await response.json() as { ok: boolean; sessionKey: string; petId: string; state: string };

    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.sessionKey, 'pet:alpha-puff');
    assert.strictEqual(data.petId, 'alpha-puff');
    assert.strictEqual(data.state, 'waving');
  });

  test('message 支持内置命令并返回 SSE 状态事件', async () => {
    const response = await fetch(`${baseUrl}/api/pet/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId: 'alpha-puff', text: '/history' }),
    });
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);

    const events = await readSse(response);
    assert.deepStrictEqual(events.map(event => event.type), ['user_message', 'state', 'text', 'state', 'done']);
    assert.strictEqual(events[0].text, '/history');
    assert.strictEqual(events[0].source, 'unknown');
    assert.strictEqual(events[0].sessionKey, 'pet:alpha-puff');
    assert.strictEqual(events[1].state, 'waiting');
    assert.match(events[2].text, /对话历史信息/);
    assert.strictEqual(events[3].state, 'waving');
    assert.strictEqual(events[4].visibleToUser, true);

    const runtimeEntries = readPetSessionEntries(testRoot)
      .filter(entry => entry.entry_type === 'runtime');
    assert.ok(runtimeEntries.some(entry =>
      entry.session_id === 'pet:alpha-puff'
      && entry.session_type === 'pet'
      && entry.message.includes('收到 pet 消息 (unknown): /history')
    ));
  });

  test('events endpoint 会把 pet agent 事件广播给桌宠订阅者', async () => {
    const controller = new AbortController();
    const eventsResponse = await fetch(`${baseUrl}/api/pet/events?petId=alpha-puff`, {
      signal: controller.signal,
    });
    assert.strictEqual(eventsResponse.status, 200);
    assert.match(eventsResponse.headers.get('content-type') || '', /text\/event-stream/);

    const eventsPromise = readSseUntil(eventsResponse, 6);
    const message = await fetch(`${baseUrl}/api/pet/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId: 'alpha-puff', text: '/history', source: 'widget' }),
    });
    assert.strictEqual(message.status, 200);
    await message.text();

    const events = await eventsPromise;
    controller.abort();

    assert.deepStrictEqual(events.map(event => event.type), ['connected', 'user_message', 'state', 'text', 'state', 'done']);
    assert.strictEqual(events[0].petId, 'alpha-puff');
    assert.strictEqual(events[1].text, '/history');
    assert.strictEqual(events[1].source, 'widget');
    assert.strictEqual(events[1].sessionKey, 'pet:alpha-puff');
    assert.strictEqual(events[2].state, 'waiting');
    assert.match(events[3].text, /对话历史信息/);
    assert.strictEqual(events[4].state, 'waving');
    assert.strictEqual(events[5].visibleToUser, true);
  });

  test('events replay 会补发 pet 对话事件给后打开的 Dashboard', async () => {
    const message = await fetch(`${baseUrl}/api/pet/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId: 'alpha-puff', text: '/history', source: 'widget' }),
    });
    assert.strictEqual(message.status, 200);
    await message.text();

    const controller = new AbortController();
    const eventsResponse = await fetch(`${baseUrl}/api/pet/events?petId=alpha-puff&replay=1`, {
      signal: controller.signal,
    });
    assert.strictEqual(eventsResponse.status, 200);

    const events = await readSseUntil(eventsResponse, 6);
    controller.abort();

    assert.deepStrictEqual(events.map(event => event.type), ['connected', 'user_message', 'state', 'text', 'state', 'done']);
    assert.strictEqual(events[1].source, 'widget');
    assert.strictEqual(events[1].text, '/history');
    assert.match(events[3].text, /对话历史信息/);
  });

  test('Dashboard chat history 会持久化为 JSONL 并在重启后 replay', async () => {
    const message = await fetch(`${baseUrl}/api/pet/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId: 'alpha-puff', text: '/history', source: 'dashboard' }),
    });
    assert.strictEqual(message.status, 200);
    await message.text();

    const historyFile = path.join(testRoot, 'data', 'chat', 'sessions', 'pet_alpha-puff.jsonl');
    assert.ok(fs.existsSync(historyFile), 'expected Dashboard chat JSONL history');

    const stored = fs.readFileSync(historyFile, 'utf-8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.deepStrictEqual(stored.map(event => event.type), ['user_message', 'state', 'text', 'state', 'done']);
    assert.ok(stored.every(event => event.petId === 'alpha-puff'));
    assert.ok(stored.every(event => typeof event.id === 'number'));
    assert.ok(stored.every(event => typeof event.timestamp === 'string'));

    const historyResponse = await fetch(`${baseUrl}/api/pet/history?petId=alpha-puff&limit=10`);
    assert.strictEqual(historyResponse.status, 200);
    const historyData = await historyResponse.json() as { petId: string; events: any[] };
    assert.strictEqual(historyData.petId, 'alpha-puff');
    assert.deepStrictEqual(historyData.events.map(event => event.type), ['user_message', 'state', 'text', 'state', 'done']);

    await closeServer(server);
    server = null;
    assert.ok(channel);
    await channel.destroy();
    channel = null;

    channel = new PetChannel();
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', channel.router);
    const listening = await listen(app);
    server = listening.server;
    baseUrl = listening.baseUrl;

    const controller = new AbortController();
    const eventsResponse = await fetch(`${baseUrl}/api/pet/events?petId=alpha-puff&replay=1`, {
      signal: controller.signal,
    });
    assert.strictEqual(eventsResponse.status, 200);

    const events = await readSseUntil(eventsResponse, 6);
    controller.abort();

    assert.deepStrictEqual(events.map(event => event.type), ['connected', 'user_message', 'state', 'text', 'state', 'done']);
    assert.strictEqual(events[1].source, 'dashboard');
    assert.strictEqual(events[1].text, '/history');
    assert.deepStrictEqual(events.slice(1).map(event => event.id), stored.map(event => event.id));
  });

  test('拒绝空消息和非法 pet id', async () => {
    const emptyMessage = await fetch(`${baseUrl}/api/pet/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId: 'alpha-puff', text: '   ' }),
    });
    assert.strictEqual(emptyMessage.status, 400);
    assert.deepStrictEqual(await emptyMessage.json(), { error: 'text required' });

    const invalidPet = await fetch(`${baseUrl}/api/pet/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId: '../alpha-puff' }),
    });
    assert.strictEqual(invalidPet.status, 400);
    assert.deepStrictEqual(await invalidPet.json(), { error: 'invalid pet id' });
  });
});

function readPetSessionEntries(root: string): any[] {
  const logRoot = path.join(root, 'logs', 'sessions', 'pet');
  const files = collectFiles(logRoot).filter(file => file.endsWith('.jsonl'));
  assert.ok(files.length > 0, 'expected pet session jsonl log');
  return files.flatMap(file => fs.readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line)));
}

function collectFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}
