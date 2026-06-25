import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { SubAgentSession } from '../src/core/sub-agent-session';
import { ChatResponse, Message, Skill } from '../src/types';
import { ToolDefinition } from '../src/types/tool';

const statusSkill: Skill = {
  metadata: {
    name: 'status-worker',
    description: 'Sub-agent status test skill',
    maxTurns: 3,
  },
  content: 'Status worker test skill.',
  filePath: path.join(process.cwd(), 'tests', 'fixtures', 'status-worker', 'SKILL.md'),
};

class FakeSkillManager {
  getSkill(name: string): Skill | undefined {
    return name === statusSkill.metadata.name ? statusSkill : undefined;
  }

  getUserInvocableSkills(): Skill[] {
    return [statusSkill];
  }
}

class ImmediateAIService {
  readonly requests: Array<{ messages: Message[]; tools: ToolDefinition[] }> = [];

  async chatStream(_messages: Message[], _tools: ToolDefinition[]): Promise<ChatResponse> {
    this.requests.push({ messages: _messages, tools: _tools });
    return { content: 'status worker completed' };
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<ChatResponse> {
    return this.chatStream(messages, tools);
  }
}

class FailingAIService {
  async chatStream(): Promise<ChatResponse> {
    throw new Error('non-retryable status failure');
  }

  async chat(): Promise<ChatResponse> {
    return this.chatStream();
  }
}

class DeferredAIService {
  private requestSeen!: () => void;
  private responseReady!: (response: ChatResponse) => void;
  readonly requestPromise = new Promise<void>(resolve => {
    this.requestSeen = resolve;
  });
  private readonly responsePromise = new Promise<ChatResponse>(resolve => {
    this.responseReady = resolve;
  });

  async chatStream(_messages: Message[], _tools: ToolDefinition[]): Promise<ChatResponse> {
    this.requestSeen();
    return this.responsePromise;
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<ChatResponse> {
    return this.chatStream(messages, tools);
  }

  resolve(response: ChatResponse): void {
    this.responseReady(response);
  }
}

function createSession(aiService: unknown, id = `sub-status-${Math.random().toString(16).slice(2)}`): SubAgentSession {
  return new SubAgentSession(
    id,
    aiService as any,
    new FakeSkillManager() as any,
    {
      skillName: statusSkill.metadata.name,
      taskDescription: 'status test task',
      userMessage: 'run status test task',
      workingDirectory: process.cwd(),
      notifyParent: async () => undefined,
    },
  );
}

describe('SubAgentSession status lifecycle', () => {
  test('starts in running while background execution is in flight', async () => {
    const ai = new DeferredAIService();
    const session = createSession(ai);
    const run = session.run();

    await ai.requestPromise;

    assert.strictEqual(session.getInfo().status, 'running');

    ai.resolve({ content: 'status worker completed' });
    await run;
    assert.strictEqual(session.getInfo().status, 'completed');
  });

  test('moves to completed after a successful run', async () => {
    const session = createSession(new ImmediateAIService());

    await session.run();
    const info = session.getInfo();

    assert.strictEqual(info.status, 'completed');
    assert.strictEqual(info.resultSummary, 'status worker completed');
    assert.ok(info.completedAt);
  });

  test('role-only run lets sub-agent choose a role-local skill', async () => {
    const ai = new ImmediateAIService();
    const session = new SubAgentSession(
      'sub-status-role-only',
      ai as any,
      new FakeSkillManager() as any,
      {
        roleName: 'reviewer-cat',
        taskDescription: 'role-only status test task',
        userMessage: 'choose the best skill for this task',
        workingDirectory: process.cwd(),
        notifyParent: async () => undefined,
      },
    );

    await session.run();
    const info = session.getInfo();
    const request = ai.requests[0];

    assert.strictEqual(info.status, 'completed');
    assert.strictEqual(info.skillSelectionMode, 'subagent_decides');
    assert.ok(request.tools.some(tool => tool.name === 'skill'));
    assert.ok(request.messages.some(message => (
      message.role === 'system'
      && typeof message.content === 'string'
      && message.content.includes('[subagent-skill-selection]')
      && message.content.includes('status-worker')
    )));
  });

  test('moves to failed after a non-retryable execution error', async () => {
    const session = createSession(new FailingAIService());

    await session.run();
    const info = session.getInfo();

    assert.strictEqual(info.status, 'failed');
    assert.match(info.resultSummary || '', /non-retryable status failure/);
    assert.ok(info.completedAt);
  });

  test('stays stopped when stopped during an in-flight run', async () => {
    const ai = new DeferredAIService();
    const session = createSession(ai);
    const run = session.run();

    await ai.requestPromise;
    session.stop();
    ai.resolve({ content: 'should not overwrite stopped' });
    await run;

    assert.strictEqual(session.getInfo().status, 'stopped');
  });

  test('moves to waiting_for_input and resumes to running', async () => {
    const session = createSession(new ImmediateAIService());
    const question = '需要主会话确认吗？';
    const wait = session.waitForParentInput(question);

    let info = session.getInfo();
    assert.strictEqual(info.status, 'waiting_for_input');
    assert.strictEqual(info.pendingQuestion, question);

    assert.strictEqual(session.resume('继续'), true);
    info = session.getInfo();
    assert.strictEqual(info.status, 'running');
    assert.strictEqual(info.pendingQuestion, undefined);
    await assert.doesNotReject(wait);
  });
});
