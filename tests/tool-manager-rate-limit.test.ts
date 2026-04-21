import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { ToolManager } from '../src/tools/tool-manager';
import { ToolCall } from '../src/types/tool';

describe('ToolManager rate limit classification', () => {
  test('send_text 抛出 429 错误时应标记为可重试的 RATE_LIMIT', async () => {
    const manager = new ToolManager(process.cwd(), {
      channel: {
        chatId: 'chat-demo',
        reply: async () => {
          throw new Error('429 Too Many Requests');
        },
        sendFile: async () => undefined,
      },
    });

    const toolCall: ToolCall = {
      id: 'tool-call-1',
      type: 'function',
      function: {
        name: 'send_text',
        arguments: JSON.stringify({ text: 'hello' }),
      },
    };

    const result = await manager.executeTool(toolCall, [], {});

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, 'RATE_LIMIT');
    assert.strictEqual(result.retryable, true);
    assert.ok(String(result.content).includes('429 Too Many Requests'));
  });
});
