import { after, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { FeishuBot } from '../../src/feishu';
import { createRoleAwareToolManager } from '../../src/bootstrap/tool-manager';
import { RoleResolver } from '../../src/utils/role-resolver';
import { readTask } from '../../src/roles/engineer-cat/utils/engineer-task-runner';
import { ChatResponse, Message } from '../../src/types';
import { ToolDefinition } from '../../src/types/tool';

const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;

class ScriptedFeishuBotAIService {
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
      throw new Error('No scripted FeishuBot E2E response left');
    }
    return response;
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<ChatResponse> {
    return this.chatStream(messages, tools);
  }
}

class CapturingFeishuSender {
  replies: Array<{ chatId: string; text: string }> = [];

  async reply(chatId: string, text: string): Promise<void> {
    this.replies.push({ chatId, text });
  }

  async sendFile(): Promise<void> {}
  async downloadFile(): Promise<string | null> { return null; }
  async fetchMergeForwardTexts(): Promise<string> { return ''; }
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

function feishuTextEvent(
  messageId: string,
  text: string,
  senderOpenId = 'ou_feishu_bot_real_codex_user',
  chatId = 'oc_feishu_bot_real_codex_chat',
) {
  return {
    sender: {
      sender_id: {
        open_id: senderOpenId,
      },
    },
    message: {
      message_id: messageId,
      chat_id: chatId,
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text }),
    },
  };
}

describe('FeishuBot Engineer real Codex E2E', () => {
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
    fs.rmSync(path.join(process.cwd(), 'data', 'sessions', 'feishu', 'user_ou_feishu_bot_real_codex_user.jsonl'), { force: true });
    fs.rmSync(path.join(process.cwd(), 'data', 'sessions', 'feishu', 'user_ou_feishu_bot_edit_codex_user.jsonl'), { force: true });
  });

  test(
    'routes an im.message.receive_v1 event through FeishuBot to EngineerCat and local Codex',
    { skip: process.env.XIAOBA_REAL_CODEX_E2E === '1' ? false : 'Set XIAOBA_REAL_CODEX_E2E=1 to run the real FeishuBot -> local Codex smoke.' },
    async () => {
      RoleResolver.activateRole('engineer-cat');
      const cwd = process.cwd();
      const taskId = `feishu-bot-real-codex-${Date.now()}`;
      const validationCommand = `${JSON.stringify(process.execPath)} -e "console.log('engineer-feishu-bot-real-validation-ok')"`;
      const ai = new ScriptedFeishuBotAIService([
        toolCall('engineer_task_run', {
          task_id: taskId,
          request: [
            '这是 XiaoBa-CLI FeishuBot im.message.receive_v1 -> EngineerCat -> 本机 Codex 的真实入口 smoke。',
            '请不要修改任何文件，只确认你能在当前项目 cwd 中被 FeishuBot 入口调用。',
            '最终只输出两行：',
            'engineer-feishu-bot-real-codex-e2e-ok',
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
        { content: `engineer 任务 ${taskId} 已完成 FeishuBot 入口真实 Codex smoke。` },
      ]);
      const sender = new CapturingFeishuSender();
      const bot = new FeishuBot({
        appId: 'cli_a_fake_app_id_for_local_e2e',
        appSecret: 'fake_app_secret_for_local_e2e',
        sessionTTL: 10_000,
      }, {
        client: {} as any,
        wsClient: { start: () => undefined } as any,
        sender: sender as any,
        agentServices: {
          aiService: ai as any,
          toolManager: createRoleAwareToolManager(cwd),
          skillManager: new EmptySkillManager() as any,
        },
      });

      try {
        await (bot as any).onMessage(feishuTextEvent(
          'om_feishu_bot_real_codex_1',
          '帮我用 engineer 通过 FeishuBot 入口真实调用本机 Codex 做一次只读 smoke。',
        ));
        await (bot as any).onMessage(feishuTextEvent(
          'om_feishu_bot_real_codex_2',
          '进度怎么样？如果 Codex 完成了就跑验证。',
        ));

        const task = readTask(taskId);
        assert.ok(task, 'engineer task should be persisted');
        assert.strictEqual(task.status, 'completed');
        assert.strictEqual(task.validation?.status, 'passed');
        assert.ok(task.codexJobId, 'codex job id should be recorded');
        assert.ok(task.codexSessionId, 'codex session id should be recorded after status sync');
        assert.match(task.lastMessage || '', /engineer-feishu-bot-real-codex-e2e-ok/);
        assert.match(fs.readFileSync(task.artifacts.validation, 'utf-8'), /engineer-feishu-bot-real-validation-ok/);
        assert.strictEqual(ai.requests[0].tools.some(tool => tool.name === 'engineer_task_run'), true);
        assert.strictEqual(ai.requests[2].tools.some(tool => tool.name === 'engineer_task_status'), true);
        assert.deepStrictEqual(sender.replies.map(reply => reply.chatId), [
          'oc_feishu_bot_real_codex_chat',
          'oc_feishu_bot_real_codex_chat',
        ]);
      } finally {
        await bot.destroy();
      }
    },
  );

  test(
    'can complete an editable FeishuBot maintenance task through local Codex',
    { skip: process.env.XIAOBA_REAL_CODEX_E2E === '1' ? false : 'Set XIAOBA_REAL_CODEX_E2E=1 to run the real FeishuBot editable Codex smoke.' },
    async () => {
      RoleResolver.activateRole('engineer-cat');
      const projectRoot = process.cwd();
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-engineer-edit-e2e-'));
      const taskId = `feishu-bot-edit-codex-${Date.now()}`;
      const marker = `engineer-feishu-bot-edit-e2e-ok-${Date.now()}`;
      const readmePath = path.join(workspace, 'README.md');
      fs.writeFileSync(readmePath, '# Editable Engineer smoke\n\npending\n');
      execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });

      const validationCommand = [
        JSON.stringify(process.execPath),
        '-e',
        JSON.stringify([
          "const fs = require('fs');",
          "const text = fs.readFileSync('README.md', 'utf8');",
          `if (!text.includes(${JSON.stringify(marker)})) throw new Error('missing editable marker');`,
          "console.log('engineer-feishu-bot-edit-validation-ok');",
        ].join(' ')),
      ].join(' ');
      const ai = new ScriptedFeishuBotAIService([
        toolCall('engineer_task_run', {
          task_id: taskId,
          request: [
            '这是 XiaoBa-CLI EngineerCat 通过 FeishuBot 入口调用本机 Codex 的可写维护 smoke。',
            `请在当前 cwd 的 README.md 末尾追加一行：${marker}`,
            '只允许修改 README.md。',
            `最终回复必须包含：${marker}`,
          ].join('\n'),
          cwd: workspace,
          allow_edits: true,
          sandbox: 'workspace-write',
          timeout_ms: 180_000,
          validation_commands: [validationCommand],
          validation_timeout_ms: 60_000,
        }),
        { content: `已创建 engineer 可写任务 ${taskId}，正在由本机 Codex 后台执行。` },
        toolCall('engineer_task_status', {
          task_id: taskId,
          wait_ms: 180_000,
          poll_interval_ms: 2_000,
          verbose: true,
        }),
        { content: `engineer 可写任务 ${taskId} 已完成。` },
      ]);
      const sender = new CapturingFeishuSender();
      const bot = new FeishuBot({
        appId: 'cli_a_fake_app_id_for_local_edit_e2e',
        appSecret: 'fake_app_secret_for_local_edit_e2e',
        sessionTTL: 10_000,
      }, {
        client: {} as any,
        wsClient: { start: () => undefined } as any,
        sender: sender as any,
        agentServices: {
          aiService: ai as any,
          toolManager: createRoleAwareToolManager(projectRoot),
          skillManager: new EmptySkillManager() as any,
        },
      });

      try {
        await (bot as any).onMessage(feishuTextEvent(
          'om_feishu_bot_edit_codex_1',
          '帮我用 engineer 通过 FeishuBot 入口真实调用本机 Codex 做一次可写维护 smoke。',
          'ou_feishu_bot_edit_codex_user',
          'oc_feishu_bot_edit_codex_chat',
        ));
        await (bot as any).onMessage(feishuTextEvent(
          'om_feishu_bot_edit_codex_2',
          '进度怎么样？如果 Codex 完成了就跑验证。',
          'ou_feishu_bot_edit_codex_user',
          'oc_feishu_bot_edit_codex_chat',
        ));

        const task = readTask(taskId);
        assert.ok(task, 'editable engineer task should be persisted');
        assert.strictEqual(task.status, 'completed');
        assert.strictEqual(task.validation?.status, 'passed');
        assert.ok(task.codexJobId, 'codex job id should be recorded');
        assert.ok(task.codexSessionId, 'codex session id should be recorded after status sync');
        assert.match(fs.readFileSync(readmePath, 'utf-8'), new RegExp(marker));
        assert.match(fs.readFileSync(task.artifacts.validation, 'utf-8'), /engineer-feishu-bot-edit-validation-ok/);
        assert.strictEqual(ai.requests[0].tools.some(tool => tool.name === 'engineer_task_run'), true);
        assert.strictEqual(ai.requests[2].tools.some(tool => tool.name === 'engineer_task_status'), true);
        assert.deepStrictEqual(sender.replies.map(reply => reply.chatId), [
          'oc_feishu_bot_edit_codex_chat',
          'oc_feishu_bot_edit_codex_chat',
        ]);
      } finally {
        await bot.destroy();
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    },
  );
});
