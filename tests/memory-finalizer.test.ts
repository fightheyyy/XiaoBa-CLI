import { afterEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AgentSession } from '../src/core/agent-session';
import { MemoryFinalizer } from '../src/utils/memory-finalizer';
import { SessionStore } from '../src/utils/session-store';
import type { Message } from '../src/types';

function system(content: string): Message {
  return { role: 'system', content };
}

function user(content: string): Message {
  return { role: 'user', content };
}

function assistant(content: string): Message {
  return { role: 'assistant', content };
}

describe('MemoryFinalizer', () => {
  const sessionKeys: string[] = [];

  afterEach(() => {
    const store = SessionStore.getInstance();
    for (const key of sessionKeys.splice(0)) {
      store.deleteSession(key);
      fs.rmSync(MemoryFinalizer.getSessionDir(key), { recursive: true, force: true });
    }
  });

  test('cleanup can finalize passive structured memory archive', async () => {
    const key = `test-memory-finalizer-${randomUUID()}`;
    sessionKeys.push(key);
    const session = new AgentSession(key, {} as any, 'feishu');
    (session as any).messages = [
      system('[session_memory]\n当前任务目标：优化 runtime harness。\n下一步：补 MemoryFinalizer 测试。\n不要重复的失败尝试：直接把 memory 写进 behavior.md。'),
      system('[im_visible_transcript]\n已告诉用户会在 TTL cleanup 生成 memory/。产物路径：harness/contextCompressor.md'),
      system('[last_turn_anchor]\nUser Input:\n继续实现 TTL memory\nSent Text:\n我会处理'),
      user('继续实现 TTL memory'),
      assistant('已更新 /Users/guowei/XiaoBa-CLI/src/core/agent-session.ts，并会运行 npm test。'),
    ];

    await session.cleanup({ finalizeMemory: true, finalizationReason: 'ttl_cleanup' });

    const memoryPath = path.join(MemoryFinalizer.getSessionDir(key), 'memory.json');
    const finalizationsPath = path.join(MemoryFinalizer.getSessionDir(key), 'finalizations.jsonl');
    assert.ok(fs.existsSync(memoryPath), '应写入 memory.json');
    assert.ok(fs.existsSync(finalizationsPath), '应写入 finalizations.jsonl');

    const archive = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
    assert.equal(archive.version, 1);
    assert.equal(archive.source, 'ttl_cleanup');
    assert.equal(archive.sessionType, 'feishu');
    assert.equal(archive.sessionKeyHash, MemoryFinalizer.hashSessionKey(key));
    assert.ok(!JSON.stringify(archive).includes(key), 'memory archive 不应包含明文 session key');
    assert.ok(archive.currentTask.goal.includes('继续实现 TTL memory'));
    assert.ok(archive.facts.some((fact: any) => fact.kind === 'session_summary' && fact.text.includes('优化 runtime harness')));
    assert.ok(archive.commitments.some((item: any) => item.text.includes('MemoryFinalizer 测试')));
    assert.ok(archive.hazards.some((item: any) => item.text.includes('behavior.md')));
    assert.ok(archive.visibleOutputs.some((item: any) => item.text.includes('TTL cleanup')));
    assert.ok(archive.artifacts.some((artifact: any) => artifact.pathOrUrl.includes('agent-session.ts')));
    assert.deepEqual((session as any).messages, []);
  });

  test('finalizer failure does not block restorable transcript save', async () => {
    const key = `test-memory-finalizer-failure-${randomUUID()}`;
    sessionKeys.push(key);
    const session = new AgentSession(key, {} as any, 'feishu');
    (session as any).messages = [
      system('[session_memory]\n当前任务：验证失败隔离。'),
      user('保存 transcript'),
      assistant('好的'),
    ];

    const original = MemoryFinalizer.finalizeSession;
    (MemoryFinalizer as any).finalizeSession = () => {
      throw new Error('finalizer boom');
    };

    try {
      await session.cleanup({ finalizeMemory: true, finalizationReason: 'ttl_cleanup' });
    } finally {
      (MemoryFinalizer as any).finalizeSession = original;
    }

    const loaded = SessionStore.getInstance().loadContext(key);
    assert.ok(loaded.some(message => message.role === 'user' && message.content === '保存 transcript'));
    assert.deepEqual((session as any).messages, []);
    assert.ok(!fs.existsSync(path.join(MemoryFinalizer.getSessionDir(key), 'memory.json')));
  });

  test('restore injects passive memory recall even when transcript store is missing', async () => {
    const key = `test-memory-recall-${randomUUID()}`;
    sessionKeys.push(key);
    MemoryFinalizer.finalizeSession(key, [
      system('[session_memory]\n当前任务目标：恢复 memory recall。\n下一步：把归档渲染回上下文。'),
      user('恢复上次上下文'),
      assistant('会从 memory/sessions 读取。'),
    ], { reason: 'ttl_cleanup', sessionType: 'cli' });

    const session = new AgentSession(key, {} as any, 'cli');
    assert.equal(session.restoreFromStore(), true);
    await session.init();

    const messages = (session as any).messages as Message[];
    const recall = messages.find(message =>
      message.role === 'system' && String(message.content).startsWith('[session_archive_memory]')
    );
    assert.ok(recall);
    assert.match(String(recall!.content), /恢复 memory recall/);
    assert.match(String(recall!.content), /被动归档记忆/);
  });

  test('summarizeAndDestroy finalizes CLI-style session memory', async () => {
    const key = `test-cli-session-close-${randomUUID()}`;
    sessionKeys.push(key);
    const aiService = {
      chat: async () => ({ content: '归档摘要：CLI 会话结束。' }),
    };
    const session = new AgentSession(key, { aiService } as any, 'cli');
    (session as any).messages = [
      system('[session_memory]\n当前任务：CLI 退出时生成 memory。'),
      user('退出前保存一下'),
      assistant('已记录 roles/engineer-cat/SPEC.md。'),
    ];

    const ok = await session.summarizeAndDestroy();

    assert.equal(ok, true);
    const archive = JSON.parse(fs.readFileSync(MemoryFinalizer.getMemoryPath(key), 'utf-8'));
    assert.equal(archive.source, 'manual_archive');
    assert.ok(archive.facts.some((fact: any) => fact.text.includes('CLI 退出时生成 memory')));
    assert.ok(archive.artifacts.some((artifact: any) => artifact.pathOrUrl.includes('roles/engineer-cat/SPEC.md')));
    const loaded = SessionStore.getInstance().loadContext(key);
    assert.ok(loaded.some(message => message.role === 'user' && message.content === '退出前保存一下'));
    assert.deepEqual((session as any).messages, []);
  });
});
