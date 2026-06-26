import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function loadPetRuntime(): any {
  const runtimePath = path.join(process.cwd(), 'dashboard', 'pet-runtime.js');
  const context: any = { window: {} };
  vm.runInNewContext(fs.readFileSync(runtimePath, 'utf-8'), context, { filename: runtimePath });
  return context.window.XiaoBaPetRuntime;
}

describe('Dashboard pet runtime event handling', () => {
  test('channel_reply text events are delivered as separate assistant messages', () => {
    const runtime = loadPetRuntime();
    const messages: Array<{ text: string; mode: string }> = [];
    const handler = runtime.createEventHandler({
      setState: () => {},
      onText: (_event: any, text: string, meta: any) => messages.push({ text, mode: meta?.mode }),
    });

    handler({ type: 'user_message', text: '开始' });
    handler({ type: 'tool_start', name: 'send_text' });
    handler({ type: 'state', state: 'review', reason: 'channel_reply' });
    handler({ type: 'text', text: '第一段' });
    handler({ type: 'tool_end', name: 'send_text' });
    handler({ type: 'tool_start', name: 'send_text' });
    handler({ type: 'state', state: 'review', reason: 'channel_reply' });
    handler({ type: 'text', text: '第二段' });

    assert.deepStrictEqual(messages, [
      { text: '第一段', mode: 'message' },
      { text: '第二段', mode: 'message' },
    ]);
  });

  test('text_stream events remain cumulative for streaming drafts', () => {
    const runtime = loadPetRuntime();
    const messages: Array<{ text: string; mode: string }> = [];
    const handler = runtime.createEventHandler({
      setState: () => {},
      onText: (_event: any, text: string, meta: any) => messages.push({ text, mode: meta?.mode }),
    });

    handler({ type: 'user_message', text: 'stream' });
    handler({ type: 'state', state: 'review', reason: 'text_stream' });
    handler({ type: 'text', text: 'Hel' });
    handler({ type: 'text', text: 'lo' });

    assert.deepStrictEqual(messages, [
      { text: 'Hel', mode: 'stream' },
      { text: 'Hello', mode: 'stream' },
    ]);
  });
});

describe('Dashboard pet page wiring', () => {
  test('main dashboard chat passes role-scoped session keys to event replay and sends', () => {
    const index = fs.readFileSync(path.join(process.cwd(), 'dashboard', 'index.html'), 'utf-8');

    assert.match(index, /function roleScopedSessionKey\(petId, roleKey\)/);
    assert.match(index, /selectedSessionKey = roleScopedSessionKey\(selectedPetId, selectedPetRole\);/);
    assert.match(index, /petClient\.connect\(selectedPetId, handlePetEvent, \{ replay: true, sessionKey: selectedSessionKey \}\)/);
    assert.match(index, /petClient\.sendMessage\(selectedPetId, text, petEventSource \? undefined : handlePetEvent, \{ source: 'dashboard', sessionKey: selectedSessionKey \}\)/);
  });

  test('main dashboard chat renders message-mode text as separate visible replies', () => {
    const index = fs.readFileSync(path.join(process.cwd(), 'dashboard', 'index.html'), 'utf-8');

    assert.match(index, /onText: \(_event, text, meta\) => \{\s*renderAssistantText\(text, meta\);/);
    assert.match(index, /if \(meta\.mode === 'message'\) \{\s*appendPetBubble\('assistant', value\);\s*currentAssistantBubble = null;\s*return;\s*\}/);
    assert.doesNotMatch(index, /function renderToolStart\(event\) \{\s*discardAssistantDraft\(\);/);
  });
});
