import { describe, test, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { ContextCompressor, contentToString, messagesToConversationText, parseCompactSummary, buildCompactSystemPrompt } from '../src/core/context-compressor';
import type { Message } from '../src/types';
import type { AIService } from '../src/utils/ai-service';

// ─── 测试辅助 ─────────────────────────────────────────────

function user(content: string): Message {
  return { role: 'user', content };
}

function assistant(content: string, toolCalls?: Message['tool_calls']): Message {
  return { role: 'assistant', content, tool_calls: toolCalls };
}

function tool(name: string, content: string, toolCallId: string): Message {
  return { role: 'tool', name, content, tool_call_id: toolCallId };
}

function system(content: string): Message {
  return { role: 'system', content };
}

function mockAIService(summaryText: string): AIService {
  return {
    chatStream: async (_messages, _tools, callbacks) => {
      callbacks?.onText?.(`<summary>\n${summaryText}\n</summary>`);
      return {
        content: `<summary>\n${summaryText}\n</summary>`,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    },
    chat: async () => ({
      content: `<summary>\n${summaryText}\n</summary>`,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }),
  } as unknown as AIService;
}

// ─── contentToString ─────────────────────────────────────

describe('contentToString', () => {
  test('string content', () => {
    const result = contentToString('hello');
    assert.equal(result, 'hello');
  });

  test('null returns empty string', () => {
    const result = contentToString(null);
    assert.equal(result, '');
  });

  test('ContentBlock[] with text', () => {
    const result = contentToString([{ type: 'text', text: 'hi' }]);
    assert.equal(result, 'hi');
  });

  test('ContentBlock[] with image returns [图片]', () => {
    const result = contentToString([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } } as any]);
    assert.equal(result, '[图片]');
  });

  test('ContentBlock[] mixed', () => {
    const result = contentToString([{ type: 'text', text: 'hello' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } } as any]);
    assert.equal(result, 'hello[图片]');
  });
});

// ─── messagesToConversationText ───────────────────────────

describe('messagesToConversationText', () => {
  test('单条 user 消息', () => {
    const msgs = [user('你好')];
    const result = messagesToConversationText(msgs);
    assert.equal(result, '[用户] 你好');
  });

  test('单条 assistant 消息', () => {
    const msgs = [assistant('今天天气不错')];
    const result = messagesToConversationText(msgs);
    assert.equal(result, '[AI] 今天天气不错');
  });

  test('工具调用链格式化正确', () => {
    const msgs = [
      user('帮我读这个文件'),
      assistant('好的', [
        { id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{"file_path":"a.txt"}' } },
      ]),
      tool('read_file', '文件内容是 hello world', 'tc1'),
      assistant('文件内容是 hello world'),
    ];
    const result = messagesToConversationText(msgs);
    assert.ok(result.includes('[用户]'), '应包含用户消息');
    assert.ok(result.includes('[AI]'), '应包含AI消息');
    assert.ok(result.includes('[工具 read_file]'), '应包含工具消息');
  });

  test('过长的工具输出被压缩为头尾预览', () => {
    const longContent = 'a'.repeat(2000);
    const msgs = [tool('bash', longContent, 'tc1')];
    const result = messagesToConversationText(msgs);
    assert.ok(result.includes('[tool:bash] 输出已压缩'), '应包含压缩标记');
    assert.ok(result.includes('原始长度: 2000 字符'), '应包含长度信息');
  });
});

// ─── parseCompactSummary ─────────────────────────────────

describe('parseCompactSummary', () => {
  test('正常提取 summary 内容', () => {
    const raw = '<analysis>分析</analysis>\n\n<summary>\n这是摘要\n</summary>';
    const result = parseCompactSummary(raw);
    assert.equal(result, '这是摘要');
  });

  test('没有 analysis 标签', () => {
    const raw = '<summary>\n纯摘要\n</summary>';
    const result = parseCompactSummary(raw);
    assert.equal(result, '纯摘要');
  });

  test('没有标签时返回原文', () => {
    const raw = '没有标签';
    const result = parseCompactSummary(raw);
    assert.equal(result, '没有标签');
  });

  test('多行摘要', () => {
    const raw = '<summary>\n第一行\n第二行\n</summary>';
    const result = parseCompactSummary(raw);
    assert.equal(result, '第一行\n第二行');
  });
});

// ─── buildCompactSystemPrompt ─────────────────────────────

describe('buildCompactSystemPrompt', () => {
  test('生成包含禁止工具调用的说明', () => {
    const prompt = buildCompactSystemPrompt();
    assert.ok(prompt.includes('Do NOT call any tools'), '应包含禁止工具调用');
  });

  test('生成包含 working-memory 要求', () => {
    const prompt = buildCompactSystemPrompt();
    assert.ok(prompt.includes('Create a working-memory summary'), '应包含新的摘要目标');
    assert.ok(prompt.includes('Next State'), '应包含 Next State 段落');
  });

  test('customInstructions 追加到 prompt', () => {
    const prompt = buildCompactSystemPrompt('聚焦代码变更');
    assert.ok(prompt.includes('Additional Instructions'), '应包含追加标记');
    assert.ok(prompt.includes('聚焦代码变更'), '应包含自定义指令');
  });

  test('空白 customInstructions 不追加', () => {
    const prompt = buildCompactSystemPrompt('   ');
    assert.ok(!prompt.includes('Additional Instructions'));
  });
});

// ─── ContextCompressor.compact ───────────────────────────

describe('ContextCompressor.compact', () => {
  let aiService: AIService;

  beforeEach(() => {
    aiService = mockAIService('1. 用户要求读文件\n2. 已完成');
  });

  test('压缩旧上下文并保留最近 3 轮', async () => {
    const compressor = new ContextCompressor(aiService);
    const messages: Message[] = [
      system('你是小八'),
      system('[surface:feishu:private]'),
      user('第零轮'),
      assistant('第零轮回答'),
      user('第一轮'),
      assistant('第一轮回答'),
      user('你好'),
      assistant('hi'),
      user('帮我读 a.txt'),
      assistant('ok', [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }]),
      tool('read_file', 'hello', 'tc1'),
      assistant('文件内容是 hello'),
    ];

    const result = await compressor.compact(messages);

    const systemMsgs = result.filter(m => m.role === 'system');
    assert.equal(systemMsgs.length, 4);

    const boundaryMsg = result.find(m => m.role === 'system' && (m.content as string).includes('[compact_boundary]'));
    assert.ok(boundaryMsg !== undefined, '应有 boundary 消息');

    const memoryMsg = result.find(m => m.role === 'system' && (m.content as string).includes('[session_memory]'));
    assert.ok(memoryMsg !== undefined, '应有 session memory');
    assert.ok((memoryMsg!.content as string).includes('用户要求读文件'));

    const recentUserMessages = result.filter(m => m.role === 'user');
    assert.equal(recentUserMessages.length, 3, '应保留最近 3 轮中的 user 消息');
    assert.ok(recentUserMessages.some(m => m.content === '第一轮'));
    assert.ok(recentUserMessages.some(m => m.content === '你好'));
    assert.ok(recentUserMessages.some(m => m.content === '帮我读 a.txt'));
    assert.ok(recentUserMessages.some(m => m.content === '第零轮') === false);
  });

  test('压缩后会生成新的 boundary 和 memory system 消息', async () => {
    const compressor = new ContextCompressor(aiService);
    const messages: Message[] = [
      system('base'),
      user('u1'),
      assistant('a1'),
      user('u2'),
      assistant('a2'),
      user('u3'),
      assistant('a3'),
      user('读文件'),
      assistant('ok', [{ id: 'tc1', type: 'function', function: { name: 'read', arguments: '{}' } }]),
      tool('read', 'file content', 'tc1'),
    ];

    const result = await compressor.compact(messages);

    const boundary = result.find(msg => msg.role === 'system' && String(msg.content).includes('[compact_boundary]'));
    const memory = result.find(msg => msg.role === 'system' && String(msg.content).includes('[session_memory]'));
    assert.ok(boundary);
    assert.ok(memory);
  });

  test('空 session 时保留 system 和既有 memory', async () => {
    const compressor = new ContextCompressor(aiService);
    const messages: Message[] = [system('base'), system('[session_memory]\n已有摘要')];
    const result = await compressor.compact(messages);
    assert.equal(result.length, 2);
    assert.ok((result[1].content as string).includes('已有摘要'));
  });

  test('AI 摘要失败时抛出异常', async () => {
    const failingService = {
      chatStream: async () => { throw new Error('API error'); },
    } as unknown as AIService;
    const compressor = new ContextCompressor(failingService);
    const messages: Message[] = [
      system('base'),
      user('u1'),
      assistant('a1'),
      user('u2'),
      assistant('a2'),
      user('u3'),
      assistant('a3'),
      user('u4'),
      assistant('a4'),
    ];

    await assert.rejects(
      async () => compressor.compact(messages),
      /API error/
    );
  });

  test('不足 3 轮时不生成 memory，只返回原会话', async () => {
    const compressor = new ContextCompressor(aiService);
    const messages: Message[] = [system('你是小八'), user('hello'), assistant('hi')];
    const result = await compressor.compact(messages);

    const roles = result.map(m => m.role);
    assert.equal(roles.filter(r => r === 'system').length, 1, '只保留原 system');
    assert.equal(roles.filter(r => r === 'user').length, 1, '保留原 user');
    assert.equal(roles.filter(r => r === 'assistant').length, 1, '保留原 assistant');
    assert.equal(roles.filter(r => r === 'tool').length, 0, '无 tool');
  });

  test('boundary 记录原始消息数和 token', async () => {
    const compressor = new ContextCompressor(aiService);
    const messages: Message[] = [
      system('base'),
      user('msg1'),
      assistant('ai1'),
      user('msg2'),
      assistant('ai2'),
      user('msg3'),
      assistant('ai3'),
      user('msg4'),
      assistant('ai4', [{ id: 'tc1', type: 'function', function: { name: 'x', arguments: '{}' } }]),
      tool('x', 'r1', 'tc1'),
    ];

    const result = await compressor.compact(messages);
    const boundary = result.find(m => m.role === 'system' && (m.content as string).includes('[compact_boundary]'));
    assert.ok(boundary !== undefined);
    assert.ok((boundary!.content as string).includes('older messages summarized'));
    assert.ok((boundary!.content as string).includes('Pre-compact tokens:'));
  });

  test('needsCompaction 正确判断', async () => {
    const compressor = new ContextCompressor(aiService, { maxContextTokens: 1000, compactionThreshold: 0.7 });
    const light: Message[] = [system('a'), user('b')];
    const heavy: Message[] = [system('a'), user('中'.repeat(900))];

    const lightResult = compressor.needsCompaction(light);
    const heavyResult = compressor.needsCompaction(heavy);
    assert.equal(lightResult, false);
    assert.equal(heavyResult, true);
  });

  test('getUsageInfo 返回正确结构', async () => {
    const compressor = new ContextCompressor(aiService, { maxContextTokens: 1000 });
    const info = compressor.getUsageInfo([system('a'), user('b')]);
    assert.equal(info.maxTokens, 1000);
    assert.equal(typeof info.usedTokens, 'number');
    assert.equal(typeof info.usagePercent, 'number');
  });
});

// ─── 全流程 ─────────────────────────────────────────────

describe('全流程：压缩 → push current_input → 推理', () => {
  test('模拟 handleMessage：压缩后追加当前输入，结构正确', async () => {
    const historyMessages: Message[] = [
      system('你是小八'),
      user('第零个问题'),
      assistant('回答零'),
      user('第一个问题'),
      assistant('回答一'),
      user('第二个问题'),
      assistant('回答二'),
      user('第三个问题'),
      assistant('回答三'),
    ];

    const aiService = mockAIService('用户问了三个问题，已全部回答。第三个问题是关于XXX。');
    const compressor = new ContextCompressor(aiService);

    // Step 1: 压缩
    const afterCompact = await compressor.compact(historyMessages);

    // Step 2: push 当前输入
    afterCompact.push(user('请继续回答第四个问题'));

    // 验证结构
    const roles = afterCompact.map(m => m.role);
    assert.equal(roles.filter(r => r === 'system').length, 3, 'base + boundary + memory');
    assert.equal(roles.filter(r => r === 'user').length, 4, '最近 3 轮 user + 当前输入');
    assert.equal(roles.filter(r => r === 'assistant').length, 3, '最近 3 轮 assistant');
    assert.equal(roles.filter(r => r === 'tool').length, 0, '无 tool');

    // 最后一条是 current_input
    const lastMsg = afterCompact[afterCompact.length - 1];
    assert.ok((lastMsg.content as string).includes('第四个问题'));

    // 无任何 tool_call_id 或 tool_calls 残留
    for (const msg of afterCompact) {
      assert.equal(msg.tool_call_id, undefined);
      if (msg.role === 'assistant') {
        assert.equal((msg as any).tool_calls, undefined);
      }
    }
  });
});
