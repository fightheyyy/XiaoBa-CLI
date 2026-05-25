import { after, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { MessageSessionManager } from '../../src/core/message-session-manager';
import { createRoleAwareToolManager } from '../../src/bootstrap/tool-manager';
import { RoleResolver } from '../../src/utils/role-resolver';
import { readTask } from '../../src/roles/engineer-cat/utils/engineer-task-runner';
import { ChatResponse, Message } from '../../src/types';
import { ToolDefinition } from '../../src/types/tool';

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
      throw new Error('No scripted Feishu E2E response left');
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

function toolCall(name: string, args: Record<string, unknown>): ChatResponse {
  return {
    content: null,
    toolCalls: [
      {
        id: `call-${name}`,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(args),
        },
      },
    ],
  };
}

describe('Feishu Engineer real Codex E2E', () => {
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
    RoleResolver.clearActiveRole();
    fs.rmSync(path.join(process.cwd(), 'data', 'sessions', 'user_feishu_real_codex_e2e.jsonl'), { force: true });
  });

  test(
    'routes a Feishu-style engineer request through engineer_task_run to the local Codex CLI',
    { skip: process.env.XIAOBA_REAL_CODEX_E2E === '1' ? false : 'Set XIAOBA_REAL_CODEX_E2E=1 to run the real local Codex smoke.' },
    async () => {
      RoleResolver.activateRole('engineer-cat');
      const cwd = process.cwd();
      const taskId = `feishu-real-codex-${Date.now()}`;
      const validationCommand = `${JSON.stringify(process.execPath)} -e "console.log('engineer-feishu-real-validation-ok')"`;
      const ai = new ScriptedFeishuAIService([
        toolCall('engineer_task_run', {
          task_id: taskId,
          request: [
            '这是 XiaoBa-CLI Feishu -> EngineerCat -> 本机 Codex 的真实端到端 smoke。',
            '请不要修改任何文件，只确认你能在当前项目 cwd 中被调用。',
            '最终只输出两行：',
            'engineer-feishu-real-codex-e2e-ok',
            'cwd=<当前工作目录>',
          ].join('\n'),
          cwd,
          allow_edits: false,
          sandbox: 'read-only',
          timeout_ms: 180_000,
          validation_commands: [validationCommand],
          validation_timeout_ms: 60_000,
        }),
        { content: `已创建 engineer 任务 ${taskId}，正在由本机 Codex 后台执行。` },
        toolCall('engineer_task_status', {
          task_id: taskId,
          wait_ms: 180_000,
          poll_interval_ms: 2_000,
          verbose: true,
        }),
        { content: `engineer 任务 ${taskId} 已完成真实 Codex smoke。` },
      ]);
      const manager = new MessageSessionManager({
        aiService: ai as any,
        toolManager: createRoleAwareToolManager(cwd),
        skillManager: new EmptySkillManager() as any,
      }, 'feishu', 10_000);
      const replies: Array<{ chatId: string; text: string }> = [];

      try {
        const session = manager.getOrCreate('user:feishu_real_codex_e2e', 'oc_real_codex_e2e');
        await session.handleMessage('帮我用 engineer 真实调用本机 Codex 做一次只读 smoke。', {
          channel: {
            chatId: 'oc_real_codex_e2e',
            reply: async (chatId: string, text: string) => {
              replies.push({ chatId, text });
            },
            sendFile: async () => undefined,
          },
        });
        await session.handleMessage('进度怎么样？如果 Codex 完成了就跑验证。', {
          channel: {
            chatId: 'oc_real_codex_e2e',
            reply: async (chatId: string, text: string) => {
              replies.push({ chatId, text });
            },
            sendFile: async () => undefined,
          },
        });

        const task = readTask(taskId);
        assert.ok(task, 'engineer task should be persisted');
        assert.strictEqual(task.status, 'completed');
        assert.strictEqual(task.validation?.status, 'passed');
        assert.ok(task.codexJobId, 'codex job id should be recorded');
        assert.ok(task.codexSessionId, 'codex session id should be recorded after status sync');
        assert.match(task.lastMessage || '', /engineer-feishu-real-codex-e2e-ok/);
        assert.match(fs.readFileSync(task.artifacts.validation, 'utf-8'), /engineer-feishu-real-validation-ok/);
        assert.strictEqual(ai.requests[0].tools.some(tool => tool.name === 'engineer_task_run'), true);
        assert.strictEqual(ai.requests[2].tools.some(tool => tool.name === 'engineer_task_status'), true);
        assert.deepStrictEqual(replies.map(reply => reply.chatId), ['oc_real_codex_e2e', 'oc_real_codex_e2e']);
      } finally {
        await manager.destroy();
      }
    },
  );
});
