import { afterEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import { randomUUID } from 'crypto';
import { SessionStore } from '../src/utils/session-store';
import type { Message } from '../src/types';

function system(content: string): Message {
  return { role: 'system', content };
}

describe('SessionStore', () => {
  const sessionKeys: string[] = [];

  afterEach(() => {
    const store = SessionStore.getInstance();
    for (const key of sessionKeys.splice(0)) {
      store.deleteSession(key);
    }
  });

  test('persists compacted runtime memory while dropping regenerated system prompts', () => {
    const key = `test-session-store-${randomUUID()}`;
    sessionKeys.push(key);
    const store = SessionStore.getInstance();
    const messages: Message[] = [
      system('base system prompt regenerated at startup'),
      system('[surface:feishu:private] regenerated surface prompt'),
      system('[skill:demo]\nturn scoped skill prompt'),
      system('[compact_boundary] 10 older messages summarized.'),
      system('[session_memory]\n用户正在排查 runtime harness。'),
      system('[im_visible_transcript]\n最近用户已经看到的 IM 输出事实。'),
      system('[last_turn_anchor]\nUser Input:\n继续上次任务'),
      { role: 'user', content: '继续' },
      { role: 'user', content: 'transient', __injected: true },
    ];

    store.saveContext(key, messages);
    const loaded = store.loadContext(key);
    const loadedContent = loaded.map(message => String(message.content));

    assert.deepStrictEqual(
      loadedContent,
      [
        '[compact_boundary] 10 older messages summarized.',
        '[session_memory]\n用户正在排查 runtime harness。',
        '[im_visible_transcript]\n最近用户已经看到的 IM 输出事实。',
        '[last_turn_anchor]\nUser Input:\n继续上次任务',
        '继续',
      ],
    );
  });
});
