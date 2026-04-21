import { Message, ContentBlock } from '../types';
import { AIService } from '../utils/ai-service';
import { estimateMessagesTokens } from './token-estimator';
import { Logger } from '../utils/logger';
import { Metrics } from '../utils/metrics';

const COMPACT_BOUNDARY_PREFIX = '[compact_boundary]';
const SESSION_MEMORY_PREFIX = '[session_memory]';
const LEGACY_SUMMARY_PREFIX = '[以下是之前 ';
const RECENT_TURNS_TO_KEEP = 3;
const MAX_EXISTING_MEMORY_CHARS = 4000;
const MAX_OLDER_CONVERSATION_CHARS = 12000;
const MAX_TOOL_RESULT_PREVIEW = 1200;
const TOOL_RESULT_HEAD_LINES = 6;
const TOOL_RESULT_TAIL_LINES = 6;
const DEFAULT_COMPACTION_THRESHOLD = 0.6;

export function resolveCompactionThreshold(): number {
  const envValue = Number(process.env.GAUZ_CONTEXT_COMPACTION_THRESHOLD);
  if (Number.isFinite(envValue) && envValue > 0 && envValue < 1) {
    return envValue;
  }
  return DEFAULT_COMPACTION_THRESHOLD;
}

export function contentToString(content: string | ContentBlock[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '[图片]';
  return content.map(block => block.type === 'text' ? block.text : '[图片]').join('');
}

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = Math.max(0, max - head - 20);
  return `${text.slice(0, head)}\n...[中间省略 ${text.length - head - tail} 字符]...\n${text.slice(text.length - tail)}`;
}

function limitSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return truncateMiddle(text, maxChars);
}

function formatLines(lines: string[], maxHead: number = 6, maxTail: number = 6): string {
  if (lines.length <= maxHead + maxTail) return lines.join('\n');
  const head = lines.slice(0, maxHead);
  const tail = lines.slice(-maxTail);
  return [...head, `...[中间省略 ${lines.length - maxHead - maxTail} 行]...`, ...tail].join('\n');
}

function summarizeToolResult(toolName: string, text: string): string {
  if (text.length <= MAX_TOOL_RESULT_PREVIEW) return text;
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map(line => line.trimEnd());
  const nonEmptyLines = lines.filter(Boolean);
  const preview = formatLines(nonEmptyLines, TOOL_RESULT_HEAD_LINES, TOOL_RESULT_TAIL_LINES);
  return [
    `[tool:${toolName}] 输出已压缩`,
    `原始长度: ${text.length} 字符, ${lines.length} 行`,
    preview,
  ].filter(Boolean).join('\n');
}

function cloneWithContent(message: Message, content: string): Message {
  return {
    ...message,
    content,
  };
}

function isCompactBoundaryMessage(message: Message): boolean {
  return message.role === 'system'
    && typeof message.content === 'string'
    && message.content.startsWith(COMPACT_BOUNDARY_PREFIX);
}

function isSessionMemoryMessage(message: Message): boolean {
  return message.role === 'system'
    && typeof message.content === 'string'
    && message.content.startsWith(SESSION_MEMORY_PREFIX);
}

function isLegacySummaryMessage(message: Message): boolean {
  return message.role === 'user'
    && typeof message.content === 'string'
    && message.content.startsWith(LEGACY_SUMMARY_PREFIX);
}

function extractSessionMemoryContent(message: Message): string {
  const text = contentToString(message.content);
  if (text.startsWith(SESSION_MEMORY_PREFIX)) {
    return text.slice(SESSION_MEMORY_PREFIX.length).trim();
  }
  if (text.startsWith(LEGACY_SUMMARY_PREFIX)) {
    return text.trim();
  }
  return text.trim();
}

export function messagesToConversationText(messages: Message[]): string {
  const lines: string[] = [];
  let pendingToolUses: Array<{ name: string; args: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = contentToString(msg.content);
      lines.push(`[用户] ${text}`);
      pendingToolUses = [];
    } else if (msg.role === 'assistant') {
      const text = contentToString(msg.content);
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCalls = msg.tool_calls.map(tc => {
          let argsObj: Record<string, unknown> = {};
          try {
            argsObj = JSON.parse(tc.function.arguments || '{}');
          } catch {}
          return `工具调用: ${tc.function.name}(${JSON.stringify(argsObj)})`;
        }).join(', ');
        lines.push(`[AI] ${text || '(无文本输出)'}。${toolCalls}`);
        pendingToolUses = msg.tool_calls.map(tc => ({
          name: tc.function.name,
          args: tc.function.arguments,
        }));
      } else if (text) {
        lines.push(`[AI] ${text}`);
        pendingToolUses = [];
      }
    } else if (msg.role === 'tool') {
      const text = summarizeToolResult(msg.name || 'unknown', contentToString(msg.content));
      const name = msg.name || 'unknown';
      lines.push(`[工具 ${name}] ${text}`);
    }
  }

  return lines.join('\n\n');
}

const COMPACT_NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.`;

export function buildCompactSystemPrompt(customInstructions?: string): string {
  let prompt = COMPACT_NO_TOOLS_PREAMBLE + '\n\n' + BASE_COMPACT_PROMPT;

  if (customInstructions && customInstructions.trim()) {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }

  prompt += `\n\nREMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block.`;
  return prompt;
}

const BASE_COMPACT_PROMPT = `Create a working-memory summary for a coding/chat agent.

This is NOT a general conversation recap. The summary must preserve only the information required to continue the task correctly after older messages are removed.

Focus on:
1. Task: the user's current goals, requested outputs, and any hard constraints.
2. Facts: confirmed facts that must remain true (paths, files, environment facts, user corrections, important dates, attachment references).
3. Work Done: actions already completed and their outcomes.
4. Failures / Warnings: failed attempts, dead ends, and things that should NOT be repeated.
5. Next State: the most important context the next model turn must remember.

Rules:
- Prefer precise facts over narrative.
- Keep the summary compact and actionable.
- Do NOT include verbose tool output.
- Do NOT copy long logs or file contents.
- If prior session memory exists, merge it carefully with the new older conversation and remove duplication.

Output format:
<analysis>
Reason about what must be preserved and what can be safely dropped.
</analysis>

<summary>
Task:
- ...

Facts:
- ...

Work Done:
- ...

Failures / Warnings:
- ...

Next State:
- ...
</summary>`;

export function parseCompactSummary(raw: string): string {
  const match = raw.match(/<summary>([\s\S]*?)<\/summary>/i);
  return match ? match[1].trim() : raw.trim();
}

export class ContextCompressor {
  private maxContextTokens: number;
  private compactionThreshold: number;
  private aiService: AIService;

  constructor(aiService: AIService, options?: {
    maxContextTokens?: number;
    compactionThreshold?: number;
  }) {
    this.aiService = aiService;
    this.maxContextTokens = options?.maxContextTokens ?? 128000;
    this.compactionThreshold = options?.compactionThreshold ?? resolveCompactionThreshold();
  }

  needsCompaction(messages: Message[]): boolean {
    const used = estimateMessagesTokens(messages);
    const threshold = this.maxContextTokens * this.compactionThreshold;
    return used > threshold;
  }

  getUsageInfo(messages: Message[]): {
    usedTokens: number;
    maxTokens: number;
    usagePercent: number;
  } {
    const used = estimateMessagesTokens(messages);
    return {
      usedTokens: used,
      maxTokens: this.maxContextTokens,
      usagePercent: Math.round((used / this.maxContextTokens) * 100),
    };
  }

  private splitRecentTurns(messages: Message[]): {
    olderMessages: Message[];
    recentMessages: Message[];
  } {
    const userIndexes: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'user' && !isLegacySummaryMessage(msg)) {
        userIndexes.push(i);
      }
    }

    if (userIndexes.length === 0) {
      return { olderMessages: [], recentMessages: messages };
    }

    if (userIndexes.length <= RECENT_TURNS_TO_KEEP) {
      return { olderMessages: [], recentMessages: messages };
    }

    const recentStart = userIndexes[userIndexes.length - RECENT_TURNS_TO_KEEP];
    return {
      olderMessages: messages.slice(0, recentStart),
      recentMessages: messages.slice(recentStart),
    };
  }

  private slimMessageForRetention(message: Message): Message {
    if (message.role !== 'tool') return message;
    const content = summarizeToolResult(message.name || 'unknown', contentToString(message.content));
    return cloneWithContent(message, content);
  }

  private buildSummaryInput(
    existingMemory: string[],
    olderMessages: Message[],
  ): string {
    const sections: string[] = [];

    if (existingMemory.length > 0) {
      sections.push(
        `Existing Session Memory:\n${limitSection(existingMemory.join('\n\n'), MAX_EXISTING_MEMORY_CHARS)}`,
      );
    }

    if (olderMessages.length > 0) {
      sections.push(
        `Older Conversation Since Last Memory:\n${limitSection(messagesToConversationText(olderMessages), MAX_OLDER_CONVERSATION_CHARS)}`,
      );
    }

    return sections.join('\n\n---\n\n');
  }

  async compact(
    messages: Message[],
    customInstructions?: string,
  ): Promise<Message[]> {
    const before = estimateMessagesTokens(messages);

    const preservedSystem = messages.filter(m =>
      m.role === 'system'
      && !isCompactBoundaryMessage(m)
      && !isSessionMemoryMessage(m),
    );
    const existingMemory = messages
      .filter(m => isSessionMemoryMessage(m) || isLegacySummaryMessage(m))
      .map(extractSessionMemoryContent)
      .filter(Boolean);
    const session = messages.filter(m =>
      m.role !== 'system'
      && !isLegacySummaryMessage(m),
    );

    if (session.length === 0) {
      const memoryMessages = existingMemory.length > 0
        ? [{
            role: 'system' as const,
            content: `${SESSION_MEMORY_PREFIX}\n${existingMemory.join('\n\n')}`,
          }]
        : [];
      return [...preservedSystem, ...memoryMessages];
    }

    const { olderMessages, recentMessages } = this.splitRecentTurns(session);
    const compactedRecent = recentMessages.map(msg => this.slimMessageForRetention(msg));
    const summaryInput = this.buildSummaryInput(existingMemory, olderMessages);

    if (!summaryInput.trim()) {
      return [
        ...preservedSystem,
        ...compactedRecent,
      ];
    }

    try {
      const summaryMessages: Message[] = [
        {
          role: 'system',
          content: buildCompactSystemPrompt(customInstructions),
        },
        {
          role: 'user',
          content: summaryInput,
        },
      ];

      let fullContent = '';
      const resp = await this.aiService.chatStream(
        summaryMessages,
        undefined,
        {
          onText: (text) => { fullContent += text; },
        }
      );
      const rawSummary = fullContent;

      if (resp.usage) {
        Metrics.recordAICall('stream', resp.usage);
      }

      const summaryText = parseCompactSummary(rawSummary);

      const boundaryMessage: Message = {
        role: 'system',
        content: `${COMPACT_BOUNDARY_PREFIX} ${olderMessages.length} older messages summarized. Pre-compact tokens: ${before}`,
      };

      const memoryMessage: Message = {
        role: 'system',
        content: `${SESSION_MEMORY_PREFIX}\n${summaryText}`,
      };

      const result: Message[] = [
        ...preservedSystem,
        boundaryMessage,
        memoryMessage,
        ...compactedRecent,
      ];

      const after = estimateMessagesTokens(result);

      Logger.info(
        `[压缩] ${messages.length} 条 → ${result.length} 条，` +
        `${before} tokens → ${after} tokens（节省 ${Math.round((1 - after / before) * 100)}%）`
      );

      return result;
    } catch (err: any) {
      Logger.error(`[压缩] AI 摘要失败: ${err.message}`);
      throw err;
    }
  }
}
