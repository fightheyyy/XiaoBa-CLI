import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Message } from '../types';

const MEMORY_ROOT = path.resolve(process.cwd(), 'memory');
const MAX_TEXT = 2000;
const MAX_RECENT_TRANSCRIPT = 12;
const MAX_RECORDS = 50;

export type MemoryFinalizationReason =
  | 'ttl_cleanup'
  | 'manual_archive'
  | 'session_close'
  | 'worker_complete'
  | 'recovery';

export interface MemorySourceRef {
  kind: 'compact_message' | 'transcript';
  prefix?: string;
  messageIndex?: number;
  role?: Message['role'];
}

export interface MemoryRecord {
  id: string;
  kind: string;
  text: string;
  source: MemorySourceRef;
  confidence: number;
  updatedAt: string;
}

export interface SessionMemoryArchive {
  version: 1;
  sessionKeyHash: string;
  sessionType?: string;
  source: MemoryFinalizationReason;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string;
  currentTask?: {
    goal: string;
    status: 'active' | 'blocked' | 'paused' | 'done';
    constraints: string[];
    nextSteps: string[];
  };
  facts: MemoryRecord[];
  artifacts: Array<{
    id: string;
    pathOrUrl: string;
    kind: 'file' | 'url' | 'command' | 'external_output';
    summary: string;
    source: MemorySourceRef;
    updatedAt: string;
  }>;
  commitments: MemoryRecord[];
  hazards: MemoryRecord[];
  visibleOutputs: MemoryRecord[];
  compact: {
    boundary?: string;
    sessionMemory?: string;
    imVisibleTranscript?: string;
    lastTurnAnchor?: string;
  };
  stats: {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    toolMessageCount: number;
    systemMessageCount: number;
  };
  recentTranscript: Array<{
    index: number;
    role: Message['role'];
    name?: string;
    toolCallId?: string;
    toolCallNames?: string[];
    content: string;
  }>;
}

export interface FinalizeSessionOptions {
  reason?: MemoryFinalizationReason;
  sessionType?: string;
  now?: Date;
}

interface IndexedText {
  text: string;
  source: MemorySourceRef;
}

const COMPACT_PREFIXES = {
  boundary: '[compact_boundary]',
  sessionMemory: '[session_memory]',
  imVisibleTranscript: '[im_visible_transcript]',
  lastTurnAnchor: '[last_turn_anchor]',
} as const;

export class MemoryFinalizer {
  static hashSessionKey(sessionKey: string): string {
    return createHash('sha256').update(sessionKey).digest('hex').slice(0, 24);
  }

  static getSessionDir(sessionKey: string): string {
    return path.join(MEMORY_ROOT, 'sessions', this.hashSessionKey(sessionKey));
  }

  static getMemoryPath(sessionKey: string): string {
    return path.join(this.getSessionDir(sessionKey), 'memory.json');
  }

  static loadSessionArchive(sessionKey: string): SessionMemoryArchive | null {
    const memoryPath = this.getMemoryPath(sessionKey);
    if (!fs.existsSync(memoryPath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(memoryPath, 'utf-8');
      return JSON.parse(raw) as SessionMemoryArchive;
    } catch {
      return null;
    }
  }

  static buildRecallMessage(sessionKey: string): Message | null {
    const archive = this.loadSessionArchive(sessionKey);
    if (!archive) {
      return null;
    }

    const lines: string[] = [
      '[session_archive_memory]',
      '被动归档记忆，仅用于恢复上下文；当前用户消息和当前 transcript 优先。',
      `source: ${archive.source}`,
      `finalizedAt: ${archive.finalizedAt}`,
    ];

    if (archive.currentTask?.goal) {
      lines.push('', 'Current Task:', `- goal: ${limitText(archive.currentTask.goal, 500)}`);
      if (archive.currentTask.nextSteps.length > 0) {
        lines.push('- next steps:');
        for (const step of archive.currentTask.nextSteps.slice(0, 5)) {
          lines.push(`  - ${limitText(step, 240)}`);
        }
      }
    }

    appendRecordSection(lines, 'Facts', archive.facts, 8);
    appendRecordSection(lines, 'Open Commitments', archive.commitments, 6);
    appendRecordSection(lines, 'Hazards / Do Not Repeat', archive.hazards, 6);

    if (archive.artifacts.length > 0) {
      lines.push('', 'Artifacts:');
      for (const artifact of archive.artifacts.slice(0, 8)) {
        lines.push(`- ${artifact.pathOrUrl}: ${limitText(artifact.summary, 240)}`);
      }
    }

    return {
      role: 'system',
      content: lines.join('\n'),
    };
  }

  static finalizeSession(
    sessionKey: string,
    messages: Message[],
    options: FinalizeSessionOptions = {},
  ): SessionMemoryArchive | null {
    if (messages.length === 0) {
      return null;
    }

    const now = options.now ?? new Date();
    const timestamp = now.toISOString();
    const sessionKeyHash = this.hashSessionKey(sessionKey);
    const compact = extractCompactMessages(messages);
    const indexedTexts = collectIndexedTexts(messages, compact);
    const recentTranscript = buildRecentTranscript(messages);
    const lastUser = [...messages]
      .reverse()
      .find(message => message.role === 'user' && !message.__injected);
    const lastUserText = lastUser ? limitText(contentToString(lastUser.content), MAX_TEXT) : '';
    const nextSteps = extractMatchingLines(indexedTexts, /(下一步|待办|todo|next|需要继续|需要处理|follow[- ]?up)/i)
      .map(item => item.text);
    const archive: SessionMemoryArchive = {
      version: 1,
      sessionKeyHash,
      sessionType: options.sessionType,
      source: options.reason ?? 'ttl_cleanup',
      createdAt: timestamp,
      updatedAt: timestamp,
      finalizedAt: timestamp,
      currentTask: lastUserText
        ? {
            goal: lastUserText,
            status: 'paused',
            constraints: [],
            nextSteps,
          }
        : undefined,
      facts: buildFacts(indexedTexts, timestamp),
      artifacts: buildArtifacts(indexedTexts, timestamp),
      commitments: buildRecords(
        indexedTexts,
        /(承诺|待办|todo|下一步|稍后|后续|还需要|需要继续|follow[- ]?up|pending|open)/i,
        'commitment',
        timestamp,
      ),
      hazards: buildRecords(
        indexedTexts,
        /(失败|错误|报错|不要重复|避免|阻塞|超时|failed|error|timeout|blocked|do not repeat)/i,
        'hazard',
        timestamp,
      ),
      visibleOutputs: buildVisibleOutputs(messages, compact, timestamp),
      compact,
      stats: {
        messageCount: messages.length,
        userMessageCount: messages.filter(message => message.role === 'user').length,
        assistantMessageCount: messages.filter(message => message.role === 'assistant').length,
        toolMessageCount: messages.filter(message => message.role === 'tool').length,
        systemMessageCount: messages.filter(message => message.role === 'system').length,
      },
      recentTranscript,
    };

    writeArchive(sessionKey, archive);
    return archive;
  }
}

function writeArchive(sessionKey: string, archive: SessionMemoryArchive): void {
  const dir = MemoryFinalizer.getSessionDir(sessionKey);
  fs.mkdirSync(dir, { recursive: true });
  const memoryPath = MemoryFinalizer.getMemoryPath(sessionKey);
  const finalizationsPath = path.join(dir, 'finalizations.jsonl');

  fs.writeFileSync(memoryPath, JSON.stringify(archive, null, 2) + '\n', 'utf-8');
  fs.appendFileSync(finalizationsPath, JSON.stringify({
    finalizedAt: archive.finalizedAt,
    source: archive.source,
    sessionKeyHash: archive.sessionKeyHash,
    messageCount: archive.stats.messageCount,
    factCount: archive.facts.length,
    artifactCount: archive.artifacts.length,
    commitmentCount: archive.commitments.length,
    hazardCount: archive.hazards.length,
  }) + '\n', 'utf-8');
}

function extractCompactMessages(messages: Message[]): SessionMemoryArchive['compact'] {
  const compact: SessionMemoryArchive['compact'] = {};
  for (const message of messages) {
    if (message.role !== 'system' || typeof message.content !== 'string') continue;
    if (message.content.startsWith(COMPACT_PREFIXES.boundary)) {
      compact.boundary = stripPrefix(message.content, COMPACT_PREFIXES.boundary);
    } else if (message.content.startsWith(COMPACT_PREFIXES.sessionMemory)) {
      compact.sessionMemory = stripPrefix(message.content, COMPACT_PREFIXES.sessionMemory);
    } else if (message.content.startsWith(COMPACT_PREFIXES.imVisibleTranscript)) {
      compact.imVisibleTranscript = stripPrefix(message.content, COMPACT_PREFIXES.imVisibleTranscript);
    } else if (message.content.startsWith(COMPACT_PREFIXES.lastTurnAnchor)) {
      compact.lastTurnAnchor = stripPrefix(message.content, COMPACT_PREFIXES.lastTurnAnchor);
    }
  }
  return compact;
}

function collectIndexedTexts(
  messages: Message[],
  compact: SessionMemoryArchive['compact'],
): IndexedText[] {
  const items: IndexedText[] = [];
  if (compact.sessionMemory) {
    items.push({
      text: compact.sessionMemory,
      source: { kind: 'compact_message', prefix: COMPACT_PREFIXES.sessionMemory },
    });
  }
  if (compact.imVisibleTranscript) {
    items.push({
      text: compact.imVisibleTranscript,
      source: { kind: 'compact_message', prefix: COMPACT_PREFIXES.imVisibleTranscript },
    });
  }
  if (compact.lastTurnAnchor) {
    items.push({
      text: compact.lastTurnAnchor,
      source: { kind: 'compact_message', prefix: COMPACT_PREFIXES.lastTurnAnchor },
    });
  }

  messages.forEach((message, index) => {
    if (message.role === 'system' || message.__injected) return;
    const text = contentToString(message.content).trim();
    if (!text) return;
    items.push({
      text,
      source: {
        kind: 'transcript',
        messageIndex: index,
        role: message.role,
      },
    });
  });
  return items;
}

function buildFacts(items: IndexedText[], timestamp: string): MemoryRecord[] {
  const facts: MemoryRecord[] = [];
  for (const item of items) {
    const kind = item.source.prefix === COMPACT_PREFIXES.sessionMemory
      ? 'session_summary'
      : item.source.prefix === COMPACT_PREFIXES.lastTurnAnchor
        ? 'last_turn_anchor'
        : item.source.prefix === COMPACT_PREFIXES.imVisibleTranscript
          ? 'visible_transcript'
          : inferFactKind(item.text);
    facts.push(makeRecord(kind, item.text, item.source, timestamp, 0.7));
    if (facts.length >= MAX_RECORDS) break;
  }
  return dedupeRecords(facts);
}

function inferFactKind(text: string): string {
  if (/(偏好|喜欢|默认|习惯|preference|prefer)/i.test(text)) return 'user_preference';
  if (/(决定|决策|采用|选择|decision|decided)/i.test(text)) return 'decision';
  if (/(约束|必须|不能|禁止|constraint|must|never)/i.test(text)) return 'constraint';
  return 'project_fact';
}

function buildRecords(
  items: IndexedText[],
  pattern: RegExp,
  kind: string,
  timestamp: string,
): MemoryRecord[] {
  const records = extractMatchingLines(items, pattern)
    .map(item => makeRecord(kind, item.text, item.source, timestamp, 0.65));
  return dedupeRecords(records).slice(0, MAX_RECORDS);
}

function buildVisibleOutputs(
  messages: Message[],
  compact: SessionMemoryArchive['compact'],
  timestamp: string,
): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  if (compact.imVisibleTranscript) {
    records.push(makeRecord(
      'im_visible_transcript',
      compact.imVisibleTranscript,
      { kind: 'compact_message', prefix: COMPACT_PREFIXES.imVisibleTranscript },
      timestamp,
      0.8,
    ));
  }

  for (let index = messages.length - 1; index >= 0 && records.length < 12; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const text = contentToString(message.content).trim();
    if (!text) continue;
    records.push(makeRecord(
      'assistant_visible_output',
      text,
      { kind: 'transcript', messageIndex: index, role: message.role },
      timestamp,
      0.6,
    ));
  }
  return dedupeRecords(records);
}

function buildArtifacts(
  items: IndexedText[],
  timestamp: string,
): SessionMemoryArchive['artifacts'] {
  const artifacts: SessionMemoryArchive['artifacts'] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const matches = extractPathLikeTokens(item.text);
    for (const token of matches) {
      if (seen.has(token)) continue;
      seen.add(token);
      artifacts.push({
        id: stableId('artifact', token),
        pathOrUrl: token,
        kind: token.startsWith('http://') || token.startsWith('https://') ? 'url' : 'file',
        summary: limitText(item.text, 300),
        source: item.source,
        updatedAt: timestamp,
      });
      if (artifacts.length >= MAX_RECORDS) return artifacts;
    }
  }
  return artifacts;
}

function buildRecentTranscript(messages: Message[]): SessionMemoryArchive['recentTranscript'] {
  const transcript = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role !== 'system' && !message.__injected)
    .slice(-MAX_RECENT_TRANSCRIPT)
    .map(({ message, index }) => ({
      index,
      role: message.role,
      name: message.name,
      toolCallId: message.tool_call_id,
      toolCallNames: message.tool_calls?.map(call => call.function.name),
      content: limitText(contentToString(message.content), 800),
    }));
  return transcript;
}

function extractMatchingLines(items: IndexedText[], pattern: RegExp): IndexedText[] {
  const matches: IndexedText[] = [];
  for (const item of items) {
    const lines = item.text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (!pattern.test(line)) continue;
      matches.push({
        text: limitText(line.replace(/^[-*]\s*/, ''), 500),
        source: item.source,
      });
      if (matches.length >= MAX_RECORDS) return matches;
    }
  }
  return matches;
}

function contentToString(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => block.type === 'text' ? block.text : '[图片]').join('');
}

function stripPrefix(text: string, prefix: string): string {
  return text.slice(prefix.length).trim();
}

function makeRecord(
  kind: string,
  text: string,
  source: MemorySourceRef,
  timestamp: string,
  confidence: number,
): MemoryRecord {
  const normalized = limitText(text.trim(), MAX_TEXT);
  return {
    id: stableId(kind, `${source.prefix || ''}:${source.messageIndex ?? ''}:${normalized}`),
    kind,
    text: normalized,
    source,
    confidence,
    updatedAt: timestamp,
  };
}

function dedupeRecords(records: MemoryRecord[]): MemoryRecord[] {
  const seen = new Set<string>();
  const result: MemoryRecord[] = [];
  for (const record of records) {
    const key = `${record.kind}:${record.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
    if (result.length >= MAX_RECORDS) break;
  }
  return result;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

function extractPathLikeTokens(text: string): string[] {
  const tokens = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>）)]+/g,
    /(?:\/[\w .@-]+)+\/?[\w .@-]+\.[A-Za-z0-9]{1,12}/g,
    /\b(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,12}\b/g,
    /\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|txt|yml|yaml|toml|py|go|rs|java|kt|swift|html|css|scss|png|jpg|jpeg|gif|webp|pdf|docx|xlsx|pptx)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const token = match[0].replace(/[，。；、:：]+$/g, '');
      if (token.length >= 3) tokens.add(token);
    }
  }
  return [...tokens].slice(0, MAX_RECORDS);
}

function limitText(text: string, max: number): string {
  const normalized = text.replace(/\s+\n/g, '\n').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.floor(max * 0.65))}\n...[中间省略 ${normalized.length - max} 字符]...\n${normalized.slice(-Math.floor(max * 0.25))}`;
}

function appendRecordSection(lines: string[], title: string, records: MemoryRecord[], limit: number): void {
  if (records.length === 0) {
    return;
  }

  lines.push('', `${title}:`);
  for (const record of records.slice(0, limit)) {
    lines.push(`- [${record.kind}, ${record.confidence.toFixed(2)}] ${limitText(record.text, 300)}`);
  }
}
