import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentSession, ERROR_MESSAGE } from '../src/core/agent-session';
import { ToolManager } from '../src/tools/tool-manager';
import { Logger } from '../src/utils/logger';
import { ChatResponse, Message } from '../src/types';
import { ToolDefinition } from '../src/types/tool';

class ScriptedAIService {
  constructor(private readonly response: ChatResponse) {}

  async chatStream(_messages: Message[], _tools: ToolDefinition[]): Promise<ChatResponse> {
    return this.response;
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<ChatResponse> {
    return this.chatStream(messages, tools);
  }
}

class FailingAIService {
  async chatStream(): Promise<ChatResponse> {
    throw new Error('provider exploded');
  }

  async chat(): Promise<ChatResponse> {
    return this.chatStream();
  }
}

class EmptySkillManager {
  async loadSkills(): Promise<void> {}
  getAllSkills(): any[] { return []; }
  getUserInvocableSkills(): any[] { return []; }
  getSkill(): any { return undefined; }
  findAutoInvocableSkillByText(): any { return undefined; }
}

describe('AgentSession session log alignment', () => {
  let testRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-session-log-'));
    process.chdir(testRoot);
    Logger.setSilentMode(true);
  });

  afterEach(() => {
    Logger.setSilentMode(false);
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('turn log can keep raw user input when the provider prompt is wrapped', async () => {
    const session = new AgentSession('pet:room:agent-1', {
      aiService: new ScriptedAIService({ content: 'done' }) as any,
      toolManager: new ToolManager(),
      skillManager: new EmptySkillManager() as any,
    }, 'pet');

    await session.handleMessage('[dashboard-room-agent]\ninternal prompt\n\nraw task', {
      logInput: 'raw task',
    });

    const entries = readSessionEntries(testRoot, 'pet');
    const turn = entries.find(entry => entry.entry_type === 'turn');
    assert.ok(turn);
    assert.strictEqual(turn.user.text, 'raw task');
    assert.strictEqual(turn.assistant.text, 'done');
  });

  test('failed provider calls still produce a turn entry for replay', async () => {
    const session = new AgentSession('pet:xiaoba', {
      aiService: new FailingAIService() as any,
      toolManager: new ToolManager(),
      skillManager: new EmptySkillManager() as any,
    }, 'pet');

    const result = await session.handleMessage('你好');

    assert.strictEqual(result.text, ERROR_MESSAGE);
    const entries = readSessionEntries(testRoot, 'pet');
    assert.ok(entries.some(entry => entry.entry_type === 'runtime' && entry.message.includes('处理失败')));
    const turn = entries.find(entry => entry.entry_type === 'turn');
    assert.ok(turn);
    assert.strictEqual(turn.user.text, '你好');
    assert.strictEqual(turn.assistant.text, ERROR_MESSAGE);
  });
});

function readSessionEntries(root: string, sessionType: string): any[] {
  const sessionRoot = path.join(root, 'logs', 'sessions', sessionType);
  const files = collectFiles(sessionRoot).filter(file => file.endsWith('.jsonl'));
  assert.strictEqual(files.length, 1);
  return fs.readFileSync(files[0], 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
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
