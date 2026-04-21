import { afterEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import { ConversationRunner } from '../src/core/conversation-runner';
import { ToolCall, ToolExecutionContext, ToolExecutor, ToolResult } from '../src/types/tool';

class StubToolExecutor implements ToolExecutor {
  private index = 0;
  callCount = 0;

  constructor(private readonly results: ToolResult[]) {}

  getToolDefinitions() {
    return [];
  }

  async executeTool(): Promise<ToolResult> {
    const next = this.results[Math.min(this.index, this.results.length - 1)];
    this.callCount += 1;
    this.index += 1;
    return next;
  }
}

const originalRetryDelay = (ConversationRunner as any).RETRY_BASE_DELAY_MS;
const originalMaxRetries = (ConversationRunner as any).MAX_RETRIES;

afterEach(() => {
  (ConversationRunner as any).RETRY_BASE_DELAY_MS = originalRetryDelay;
  (ConversationRunner as any).MAX_RETRIES = originalMaxRetries;
});

function createRunner(executor: ToolExecutor): ConversationRunner {
  return new ConversationRunner({} as any, executor, {
    enableCompression: false,
  });
}

function createToolCall(name: string): ToolCall {
  return {
    id: 'tool-call-1',
    type: 'function',
    function: {
      name,
      arguments: '{}',
    },
  };
}

function createContext(): Partial<ToolExecutionContext> {
  return {
    workingDirectory: process.cwd(),
    conversationHistory: [],
    surface: 'cli',
  };
}

describe('ConversationRunner rate limit retry', () => {
  test('普通失败结果里出现 429 数字时不应误判为限流重试', async () => {
    const executor = new StubToolExecutor([
      {
        tool_call_id: 'tool-call-1',
        role: 'tool',
        name: 'execute_shell',
        ok: true,
        content: '命令执行失败: 论文统计里有 429 个样本，但这不是限流错误',
      },
    ]);
    const runner = createRunner(executor);

    (ConversationRunner as any).RETRY_BASE_DELAY_MS = 0;
    (ConversationRunner as any).MAX_RETRIES = 1;

    const result = await (runner as any).executeToolWithRetry(
      createToolCall('execute_shell'),
      [],
      createContext(),
      1,
    );

    assert.strictEqual(executor.callCount, 1);
    assert.strictEqual(result.content, '命令执行失败: 论文统计里有 429 个样本，但这不是限流错误');
  });

  test('明确的 429 限流失败应触发一次重试', async () => {
    const executor = new StubToolExecutor([
      {
        tool_call_id: 'tool-call-1',
        role: 'tool',
        name: 'send_text',
        ok: false,
        errorCode: 'RATE_LIMIT',
        retryable: true,
        content: '工具执行错误: 429 Too Many Requests',
      },
      {
        tool_call_id: 'tool-call-1',
        role: 'tool',
        name: 'send_text',
        ok: true,
        content: '已发送',
      },
    ]);
    const runner = createRunner(executor);

    (ConversationRunner as any).RETRY_BASE_DELAY_MS = 0;
    (ConversationRunner as any).MAX_RETRIES = 1;

    const result = await (runner as any).executeToolWithRetry(
      createToolCall('send_text'),
      [],
      createContext(),
      1,
    );

    assert.strictEqual(executor.callCount, 2);
    assert.strictEqual(result.content, '已发送');
  });
});
