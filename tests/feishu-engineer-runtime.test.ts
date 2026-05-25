import { afterEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { MessageSessionManager } from '../src/core/message-session-manager';
import { createRoleAwareToolManager } from '../src/bootstrap/tool-manager';
import { RoleResolver } from '../src/utils/role-resolver';
import { Message, ChatResponse } from '../src/types';
import { Tool, ToolDefinition, ToolExecutionContext } from '../src/types/tool';

const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

class ScriptedFeishuAIService {
  requests: Array<{ messages: Message[]; tools: ToolDefinition[] }> = [];
  private index = 0;

  constructor(private readonly responses: ChatResponse[]) {}

  async chatStream(messages: Message[], tools: ToolDefinition[]): Promise<ChatResponse> {
    this.requests.push({
      messages: messages.map(message => ({ ...message })),
      tools,
    });
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) {
      throw new Error('No scripted response left');
    }
    return response;
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<ChatResponse> {
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

class FakeEngineerTaskRunTool implements Tool {
  calls: Array<{ args: any; context: ToolExecutionContext }> = [];
  definition: ToolDefinition = {
    name: 'engineer_task_run',
    description: 'fake engineer task run',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string' },
      },
      required: ['request'],
    },
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    this.calls.push({ args, context });
    return [
      'engineer_task: running=true status=running',
      'task_id=feishu-smoke',
      'codex_job_id=codex-job-smoke',
      'codex_session_id=codex-session-smoke',
    ].join('\n');
  }
}

function engineerTaskToolCall(): ChatResponse {
  return {
    content: null,
    toolCalls: [
      {
        id: 'call-engineer-task-run',
        type: 'function',
        function: {
          name: 'engineer_task_run',
          arguments: JSON.stringify({
            request: '维护 XiaoBa-CLI engineer 角色，并用 Codex 后台执行。',
            cwd: process.cwd(),
            allow_edits: false,
            sandbox: 'read-only',
            validation_commands: ['npm run build'],
          }),
        },
      },
    ],
  };
}

describe('Feishu Engineer runtime', () => {
  afterEach(() => {
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
    RoleResolver.clearActiveRole();
    const sessionFile = path.join(process.cwd(), 'data', 'sessions', 'user_ou_engineer_tester.jsonl');
    fs.rmSync(sessionFile, { force: true });
  });

  test('Feishu message sessions expose engineer task tools and can route a message to engineer_task_run', async () => {
    RoleResolver.activateRole('engineer-cat');
    const feishuSource = fs.readFileSync(path.join(process.cwd(), 'src', 'feishu', 'index.ts'), 'utf-8');
    assert.match(feishuSource, /createRoleAwareToolManager\(\)/);

    const fakeTool = new FakeEngineerTaskRunTool();
    const toolManager = createRoleAwareToolManager();
    assert.ok(toolManager.getTool('engineer_task_run'));
    assert.ok(toolManager.getTool('engineer_task_status'));
    assert.ok(toolManager.getTool('codex_job_start'));
    assert.ok(toolManager.getTool('codex_job_resume'));
    toolManager.registerTool(fakeTool);

    const ai = new ScriptedFeishuAIService([
      engineerTaskToolCall(),
      { content: '已创建 engineer 任务 feishu-smoke，正在由本机 Codex 后台执行。' },
    ]);
    const manager = new MessageSessionManager({
      aiService: ai as any,
      toolManager,
      skillManager: new EmptySkillManager() as any,
    }, 'feishu', 10_000);
    const replies: Array<{ chatId: string; text: string }> = [];

    try {
      const session = manager.getOrCreate('user:ou_engineer_tester', 'oc_engineer_chat');
      await session.handleMessage('早上好，帮我维护 XiaoBa-CLI 的 engineer 角色。', {
        channel: {
          chatId: 'oc_engineer_chat',
          reply: async (chatId: string, text: string) => {
            replies.push({ chatId, text });
          },
          sendFile: async () => undefined,
        },
      });

      assert.strictEqual(fakeTool.calls.length, 1);
      assert.strictEqual(fakeTool.calls[0].context.surface, 'feishu');
      assert.strictEqual(fakeTool.calls[0].context.channel?.chatId, 'oc_engineer_chat');
      assert.match(fakeTool.calls[0].args.request, /XiaoBa-CLI engineer/);
      assert.deepStrictEqual(fakeTool.calls[0].args.validation_commands, ['npm run build']);
      assert.strictEqual(ai.requests[0].tools.some(tool => tool.name === 'engineer_task_run'), true);
      assert.strictEqual(ai.requests[0].tools.some(tool => tool.name === 'codex_job_start'), true);
      assert.deepStrictEqual(replies, [
        {
          chatId: 'oc_engineer_chat',
          text: '已创建 engineer 任务 feishu-smoke，正在由本机 Codex 后台执行。',
        },
      ]);
    } finally {
      await manager.destroy();
    }
  });
});
