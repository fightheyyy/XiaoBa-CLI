import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { normalizeDashboardRoomMessageSurfaceEvent, RoomChannel } from '../src/dashboard/room-channel';
import type { AgentServices } from '../src/core/agent-session';
import { runEvalSuite } from '../src/eval/eval-runner';
import { ToolManager } from '../src/tools/tool-manager';
import type { ChatResponse, Message } from '../src/types';
import type { ToolDefinition } from '../src/types/tool';
import { Logger } from '../src/utils/logger';
import { RoleResolver } from '../src/utils/role-resolver';
import { visibleHistoryFilePath } from '../src/utils/visible-history-paths';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

class SendTextAIService {
  requests: Array<{ messages: Message[]; toolNames: string[] }> = [];

  async chatStream(messages: Message[], tools: ToolDefinition[] = []): Promise<ChatResponse> {
    this.requests.push({
      messages: messages.map(message => ({ ...message })),
      toolNames: tools.map(tool => tool.name),
    });

    if (this.requests.length === 1) {
      return {
        content: null,
        toolCalls: [
          {
            id: 'room-send-text-1',
            type: 'function',
            function: {
              name: 'send_text',
              arguments: JSON.stringify({ text: 'dashboard room visible history' }),
            },
          },
        ],
      };
    }

    return { content: '' };
  }

  async chat(messages: Message[], tools: ToolDefinition[] = []): Promise<ChatResponse> {
    return this.chatStream(messages, tools);
  }
}

class EmptySkillManager {
  async loadSkills(): Promise<void> {}
  getAllSkills(): any[] { return []; }
  getUserInvocableSkills(): any[] { return []; }
  getSkill(): any { return undefined; }
  findAutoInvocableSkillByText(): any { return undefined; }
}

describe('Dashboard Room visible history', () => {
  let testRoot: string;
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-room-history-'));
    process.chdir(testRoot);
    Logger.setSilentMode(true);
    writeRole(testRoot, 'engineer-cat');
    writePet(testRoot, 'xiaoba');

    const channel = new RoomChannel({
      createAgentServices: (): AgentServices => ({
        aiService: new SendTextAIService() as any,
        toolManager: new ToolManager(),
        skillManager: new EmptySkillManager() as any,
        roleName: 'engineer-cat',
      }),
    });
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', channel.router);
    const listening = await listen(app);
    server = listening.server;
    baseUrl = listening.baseUrl;
  });

  test('normalizes body and metadata traceparent without accepting invalid values', () => {
    const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const event = normalizeDashboardRoomMessageSurfaceEvent('agent-1', {
      text: 'hello room',
      metadata: { traceparent },
    });
    assert.equal(event.traceparent, traceparent);

    const invalid = normalizeDashboardRoomMessageSurfaceEvent('agent-1', {
      text: 'hello room',
      traceparent: 'not-a-valid-traceparent',
    });
    assert.equal(invalid.traceparent, undefined);
  });

  afterEach(async () => {
    Logger.setSilentMode(false);
    await closeServer(server);
    server = null;
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    restoreEnv('XIAOBA_ROLE', originalRole);
    restoreEnv('CURRENT_ROLE', originalCurrentRole);
    restoreEnv('CURRENT_ROLE_DISPLAY_NAME', originalCurrentRoleDisplayName);
  });

  test('Room SSE events persist to dashboard visible history and match live state boundary refs', async () => {
    const createResponse = await fetch(`${baseUrl}/api/room/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleName: 'engineer-cat', cwd: testRoot }),
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as { agent: { id: string } };
    const agentId = created.agent.id;
    const sessionKey = `pet:room:${agentId}`;

    const messageResponse = await fetch(`${baseUrl}/api/room/agents/${encodeURIComponent(agentId)}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '记录 room 可见历史' }),
    });
    assert.equal(messageResponse.status, 200);
    const events = await readSse(messageResponse);
    assert.ok(events.some(event => event.type === 'user_message' && event.sessionKey === sessionKey));
    assert.ok(events.some(event => event.type === 'text' && event.text === 'dashboard room visible history'));
    assert.ok(events.some(event => event.type === 'done'));

    const historyPath = visibleHistoryFilePath('dashboard', sessionKey);
    assert.ok(fs.existsSync(historyPath), 'dashboard room visible history should be durable');
    const history = fs.readFileSync(historyPath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    assert.ok(history.some(event => event.type === 'state' && event.reason === 'created'));
    assert.ok(history.some(event => event.type === 'text' && event.text === 'dashboard room visible history'));
    assert.ok(history.every(event => event.agentId === agentId));
    assert.ok(history.every(event => event.sessionKey === sessionKey));

    const turn = readDashboardTurn(testRoot);
    assert.equal(turn.state_boundary.visible_history.ref, `data/chat/dashboard-room/${sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`);

    const suitePath = path.join(testRoot, 'dashboard-state-boundary-suite.json');
    fs.writeFileSync(suitePath, JSON.stringify({
      suite_id: 'dashboard-live-state-boundary',
      name: 'Dashboard Live State Boundary',
      version: '0.1-test',
      decision_policy: {
        fail_on_any_hard_failure: true,
        block_on_missing_evidence: true,
        min_pass_rate: 1,
      },
      cases: [
        {
          case_id: 'dashboard.live-state-boundary.001',
          name: 'Dashboard live state boundary',
          lane: 'contract_sentinel',
          target_module: 'state_evidence',
          risk_level: 'release_blocking',
          inputs: {
            jsonl: readDashboardLogFile(testRoot),
            jsonl_schema: 'session-log-v2',
          },
          hard_verifiers: [
            { id: 'jsonl_parse' },
            {
              id: 'state_boundary_contract',
              config: { require_visible_history: true },
            },
            { id: 'budget_check' },
          ],
          budgets: {
            max_turns: 1,
            max_tool_calls: 1,
            max_tokens: 1000,
          },
          failure_route: 'state_evidence',
        },
      ],
    }, null, 2) + '\n', 'utf-8');

    const scorecard = await runEvalSuite({
      suitePath,
      outDir: path.join(testRoot, 'eval-output'),
      now: new Date('2026-06-04T00:00:00.000Z'),
    });
    assert.equal(scorecard.summary.decision, 'pass');
  });
});

function writeRole(root: string, name: string): void {
  const roleDir = path.join(root, 'roles', name);
  fs.mkdirSync(roleDir, { recursive: true });
  fs.writeFileSync(path.join(roleDir, 'role.json'), JSON.stringify({
    name,
    displayName: name,
    description: `${name} test role`,
    metadata: { petId: 'xiaoba' },
  }, null, 2) + '\n', 'utf-8');
}

function writePet(root: string, id: string): void {
  const petDir = path.join(root, 'dashboard', 'pets', id);
  fs.mkdirSync(petDir, { recursive: true });
  fs.writeFileSync(path.join(petDir, 'pet.json'), JSON.stringify({
    id,
    displayName: id,
    description: `${id} test pet`,
    spritesheetPath: 'spritesheet.webp',
  }, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(path.join(petDir, 'spritesheet.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]));
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

function readDashboardLogFile(root: string): string {
  const sessionRoot = path.join(root, 'logs', 'sessions', 'dashboard');
  const files = collectFiles(sessionRoot).filter(file => file.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  return files[0];
}

function readDashboardTurn(root: string): any {
  const entries = fs.readFileSync(readDashboardLogFile(root), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const turn = entries.find(entry => entry.entry_type === 'trace' || entry.entry_type === 'turn');
  assert.ok(turn);
  return turn;
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

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
