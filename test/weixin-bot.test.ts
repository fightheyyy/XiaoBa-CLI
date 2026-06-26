import { afterEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WeixinBot } from '../src/weixin';
import type { HandleMessageResult } from '../src/core/agent-session';

class FakeWeixinSender {
  texts: Array<{ to: string; text: string; contextToken?: string }> = [];

  async sendText(to: string, text: string, contextToken?: string): Promise<void> {
    this.texts.push({ to, text, contextToken });
  }
}

class FakeWeixinSession {
  messages: Array<{ text: string; surface?: string }> = [];

  constructor(private readonly result: HandleMessageResult) {}

  runWithLogContext(fn: () => void): void {
    fn();
  }

  async handleMessage(text: string, options: { surface?: string }): Promise<HandleMessageResult> {
    this.messages.push({ text, surface: options.surface });
    return this.result;
  }

  isBusy(): boolean {
    return false;
  }
}

class FakeWeixinSessionManager {
  constructor(private readonly session: FakeWeixinSession) {}

  getOrCreate(): FakeWeixinSession {
    return this.session;
  }

  async destroy(): Promise<void> {}
}

function textMessage(text: string): Record<string, unknown> {
  return {
    message_id: 'wx-msg-1',
    message_type: 0,
    from_user_id: 'wx-user',
    to_user_id: 'wx-bot',
    context_token: 'ctx-1',
    item_list: [
      { type: 1, text_item: { text } },
    ],
  };
}

describe('WeixinBot final response delivery', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('sends final response when AgentSession marks it visible', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-weixin-bot-'));
    roots.push(stateDir);
    const bot = new WeixinBot({
      token: 'token',
      baseUrl: 'https://weixin.invalid',
      cdnBaseUrl: 'https://cdn.weixin.invalid',
      stateDir,
    });
    const sender = new FakeWeixinSender();
    const session = new FakeWeixinSession({
      text: 'provider error visible to user',
      visibleToUser: true,
      finalResponseVisible: true,
    });
    await (bot as any).sessionManager.destroy();
    (bot as any).sender = sender;
    (bot as any).sessionManager = new FakeWeixinSessionManager(session);

    await (bot as any).handleMessage(textMessage('hello'));
    await bot.destroy();

    assert.deepStrictEqual(session.messages, [{ text: 'hello', surface: 'weixin' }]);
    assert.deepStrictEqual(sender.texts, [
      { to: 'wx-user', text: 'provider error visible to user', contextToken: 'ctx-1' },
    ]);
  });

  test('does not send hidden final response text', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-weixin-bot-'));
    roots.push(stateDir);
    const bot = new WeixinBot({
      token: 'token',
      baseUrl: 'https://weixin.invalid',
      cdnBaseUrl: 'https://cdn.weixin.invalid',
      stateDir,
    });
    const sender = new FakeWeixinSender();
    const session = new FakeWeixinSession({
      text: 'hidden trace text',
      visibleToUser: true,
      finalResponseVisible: false,
    });
    await (bot as any).sessionManager.destroy();
    (bot as any).sender = sender;
    (bot as any).sessionManager = new FakeWeixinSessionManager(session);

    await (bot as any).handleMessage(textMessage('hello'));
    await bot.destroy();

    assert.deepStrictEqual(sender.texts, []);
  });
});
