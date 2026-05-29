import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Message } from '../types';

const MEMORY_ROOT = path.resolve(process.cwd(), 'memory');
const MAX_MEMORY_TEXT = 500;
const MAX_RECORDS_PER_KIND = 50;

export type MemoryFinalizationReason =
  | 'ttl_cleanup'
  | 'manual_archive'
  | 'session_close'
  | 'worker_complete'
  | 'recovery';

export type LongTermMemoryKind = 'preference' | 'habit' | 'instruction' | 'fact';
export type LongTermMemoryConfidence = 'high' | 'medium';

export interface MemorySourceRef {
  kind: 'compact_message' | 'transcript' | 'markdown';
  prefix?: string;
  messageIndex?: number;
  role?: Message['role'];
}

export interface LongTermMemoryRecord {
  id: string;
  kind: LongTermMemoryKind;
  text: string;
  source: MemorySourceRef;
  confidence: LongTermMemoryConfidence;
  firstSeenAt: string;
  updatedAt: string;
}

export interface SessionLongTermMemory {
  version: 1;
  scope: 'session-person';
  sessionKeyHash: string;
  loadPolicy: 'on_demand';
  updatedAt: string;
  records: LongTermMemoryRecord[];
}

export interface MemoryFinalizationResult {
  version: 1;
  sessionKeyHash: string;
  sessionType?: string;
  source: MemoryFinalizationReason;
  updatedAt: string;
  memoryPath: string;
  added: LongTermMemoryRecord[];
  records: LongTermMemoryRecord[];
  totalRecords: number;
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
  sessionMemory: '[session_memory]',
} as const;

const SECTION_BY_KIND: Record<LongTermMemoryKind, string> = {
  preference: 'Stable Preferences',
  habit: 'Work Habits',
  instruction: 'Instructions',
  fact: 'Facts',
};

const KIND_BY_SECTION = Object.fromEntries(
  Object.entries(SECTION_BY_KIND).map(([kind, title]) => [title, kind]),
) as Record<string, LongTermMemoryKind>;

const DURABLE_MEMORY_PATTERN = /(记住|以后|今后|默认|总是|始终|每次|偏好|喜欢|习惯|常用|叫我|称呼|不要|别|避免|prefer|preference|remember|always|default|habit|usually|call me|my name is)/i;
const TRANSIENT_PATTERN = /(当前任务|这次任务|下一步|待办|todo|刚才|本轮|临时|报错|失败|修复|实现|运行测试|npm test|文件路径|commit|pull request|\bPR\b)/i;

export class MemoryFinalizer {
  static hashSessionKey(sessionKey: string): string {
    return createHash('sha256').update(sessionKey).digest('hex').slice(0, 24);
  }

  static getSessionDir(sessionKey: string): string {
    return path.join(MEMORY_ROOT, 'sessions', this.hashSessionKey(sessionKey));
  }

  static getMemoryPath(sessionKey: string): string {
    return path.join(this.getSessionDir(sessionKey), 'MEMORY.md');
  }

  static loadSessionMemory(sessionKey: string): SessionLongTermMemory | null {
    const memoryPath = this.getMemoryPath(sessionKey);
    if (!fs.existsSync(memoryPath)) {
      return null;
    }

    const records = readMemoryRecords(memoryPath);
    const raw = fs.readFileSync(memoryPath, 'utf-8');
    const updatedAt = readFrontmatterValue(raw, 'updatedAt') || newestUpdatedAt(records) || new Date(0).toISOString();
    return {
      version: 1,
      scope: 'session-person',
      sessionKeyHash: this.hashSessionKey(sessionKey),
      loadPolicy: 'on_demand',
      updatedAt,
      records,
    };
  }

  static finalizeSession(
    sessionKey: string,
    messages: Message[],
    options: FinalizeSessionOptions = {},
  ): MemoryFinalizationResult | null {
    if (messages.length === 0) {
      return null;
    }

    const now = options.now ?? new Date();
    const timestamp = now.toISOString();
    const sessionKeyHash = this.hashSessionKey(sessionKey);
    const memoryPath = this.getMemoryPath(sessionKey);
    const existing = fs.existsSync(memoryPath) ? readMemoryRecords(memoryPath) : [];
    const candidates = extractLongTermRecords(messages, timestamp);
    const { records, added } = mergeRecords(existing, candidates);

    if (added.length === 0) {
      return null;
    }

    writeMemoryMarkdown(memoryPath, {
      version: 1,
      scope: 'session-person',
      sessionKeyHash,
      loadPolicy: 'on_demand',
      updatedAt: timestamp,
      records,
    });

    return {
      version: 1,
      sessionKeyHash,
      sessionType: options.sessionType,
      source: options.reason ?? 'ttl_cleanup',
      updatedAt: timestamp,
      memoryPath,
      added,
      records,
      totalRecords: records.length,
    };
  }
}

function extractLongTermRecords(messages: Message[], timestamp: string): LongTermMemoryRecord[] {
  const items = collectIndexedTexts(messages);
  const records: LongTermMemoryRecord[] = [];

  for (const item of items) {
    for (const line of splitCandidateLines(item.text)) {
      if (!looksLikeLongTermMemory(line)) continue;
      const text = normalizeMemoryText(line);
      if (!text) continue;
      const kind = classifyMemoryKind(text);
      records.push(makeRecord(kind, text, item.source, timestamp, item.source.kind === 'compact_message' ? 'medium' : 'high'));
    }
  }

  return dedupeAndLimit(records);
}

function collectIndexedTexts(messages: Message[]): IndexedText[] {
  const items: IndexedText[] = [];

  messages.forEach((message, index) => {
    if (message.__injected) return;
    if (message.role === 'user') {
      const text = contentToString(message.content).trim();
      if (text) {
        items.push({
          text,
          source: { kind: 'transcript', messageIndex: index, role: message.role },
        });
      }
      return;
    }

    if (message.role !== 'system' || typeof message.content !== 'string') return;
    if (message.content.startsWith(COMPACT_PREFIXES.sessionMemory)) {
      items.push({
        text: stripPrefix(message.content, COMPACT_PREFIXES.sessionMemory),
        source: { kind: 'compact_message', prefix: COMPACT_PREFIXES.sessionMemory },
      });
    }
  });

  return items;
}

function splitCandidateLines(text: string): string[] {
  return text
    .split(/\r?\n|[。！？!?；;]/)
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function looksLikeLongTermMemory(line: string): boolean {
  if (line.length < 4) return false;
  if (!DURABLE_MEMORY_PATTERN.test(line)) return false;
  return !TRANSIENT_PATTERN.test(line);
}

function normalizeMemoryText(line: string): string {
  let text = line
    .replace(/^用户(?:说|要求)?[:：]\s*/, '用户')
    .replace(/^请(?:你)?/, '')
    .trim();

  const rememberMatch = text.match(/^(?:帮我)?记住[:：]?\s*(.+)$/);
  if (rememberMatch) {
    text = `用户要求记住${rememberMatch[1].trim()}`;
  } else if (text.startsWith('我')) {
    text = `用户${text.slice(1)}`;
  } else if (/^(以后|今后|默认|总是|始终|每次|不要|别|避免)/.test(text)) {
    text = `用户希望${text}`;
  } else if (/^(叫我|称呼我)/.test(text)) {
    text = `用户希望${text}`;
  } else if (!text.startsWith('用户')) {
    text = `用户记忆：${text}`;
  }

  return ensureSentence(limitText(text, MAX_MEMORY_TEXT));
}

function classifyMemoryKind(text: string): LongTermMemoryKind {
  if (/(喜欢|偏好|prefer|preference)/i.test(text)) return 'preference';
  if (/(习惯|常用|usually|habit)/i.test(text)) return 'habit';
  if (/(叫我|称呼|名字|用户名|GitHub|记住|remember|my name is)/i.test(text)) return 'fact';
  return 'instruction';
}

function makeRecord(
  kind: LongTermMemoryKind,
  text: string,
  source: MemorySourceRef,
  timestamp: string,
  confidence: LongTermMemoryConfidence,
): LongTermMemoryRecord {
  return {
    id: stableId(kind, text),
    kind,
    text,
    source,
    confidence,
    firstSeenAt: timestamp,
    updatedAt: timestamp,
  };
}

function mergeRecords(
  existing: LongTermMemoryRecord[],
  candidates: LongTermMemoryRecord[],
): { records: LongTermMemoryRecord[]; added: LongTermMemoryRecord[] } {
  const byId = new Map<string, LongTermMemoryRecord>();
  for (const record of existing) {
    byId.set(record.id, record);
  }

  const added: LongTermMemoryRecord[] = [];
  for (const candidate of candidates) {
    if (byId.has(candidate.id)) continue;
    byId.set(candidate.id, candidate);
    added.push(candidate);
  }

  return {
    records: sortRecords([...byId.values()]),
    added,
  };
}

function dedupeAndLimit(records: LongTermMemoryRecord[]): LongTermMemoryRecord[] {
  const byId = new Map<string, LongTermMemoryRecord>();
  for (const record of records) {
    if (byId.has(record.id)) continue;
    byId.set(record.id, record);
  }
  return sortRecords([...byId.values()]).filter((record, index, all) => {
    const sameKindBefore = all.slice(0, index).filter(item => item.kind === record.kind).length;
    return sameKindBefore < MAX_RECORDS_PER_KIND;
  });
}

function sortRecords(records: LongTermMemoryRecord[]): LongTermMemoryRecord[] {
  const order: LongTermMemoryKind[] = ['preference', 'habit', 'instruction', 'fact'];
  return records.sort((a, b) => {
    const kindDiff = order.indexOf(a.kind) - order.indexOf(b.kind);
    if (kindDiff !== 0) return kindDiff;
    return a.text.localeCompare(b.text);
  });
}

function writeMemoryMarkdown(memoryPath: string, doc: SessionLongTermMemory): void {
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  const lines: string[] = [
    '---',
    'version: 1',
    'scope: session-person',
    'loadPolicy: on_demand',
    `sessionKeyHash: ${doc.sessionKeyHash}`,
    `updatedAt: ${doc.updatedAt}`,
    '---',
    '',
    '# Long-Term Memory',
    '',
    'These notes are not loaded by default. Recall only the small, relevant subset when the user asks or the task clearly needs stable preferences.',
  ];

  for (const kind of ['preference', 'habit', 'instruction', 'fact'] as LongTermMemoryKind[]) {
    lines.push('', `## ${SECTION_BY_KIND[kind]}`, '');
    const records = doc.records.filter(record => record.kind === kind);
    if (records.length === 0) {
      lines.push('- _None yet._');
      continue;
    }

    for (const record of records) {
      lines.push(`- ${record.text} <!-- id: ${record.id}; source: ${sourceLabel(record.source)}; confidence: ${record.confidence}; updated: ${record.updatedAt} -->`);
    }
  }

  fs.writeFileSync(memoryPath, `${lines.join('\n')}\n`, 'utf-8');
}

function readMemoryRecords(memoryPath: string): LongTermMemoryRecord[] {
  const raw = fs.readFileSync(memoryPath, 'utf-8');
  const records: LongTermMemoryRecord[] = [];
  let currentKind: LongTermMemoryKind | undefined;

  for (const rawLine of raw.split(/\r?\n/)) {
    const sectionMatch = rawLine.match(/^##\s+(.+?)\s*$/);
    if (sectionMatch) {
      currentKind = KIND_BY_SECTION[sectionMatch[1]];
      continue;
    }

    if (!currentKind) continue;
    const line = rawLine.trim();
    if (!line.startsWith('- ') || line.includes('_None yet._')) continue;

    const commentMatch = line.match(/<!--\s*(.*?)\s*-->/);
    const text = line
      .replace(/^-\s*/, '')
      .replace(/\s*<!--.*?-->\s*$/, '')
      .trim();
    if (!text) continue;

    const meta = parseMetadata(commentMatch?.[1] || '');
    const updatedAt = meta.updated || new Date(0).toISOString();
    records.push({
      id: meta.id || stableId(currentKind, text),
      kind: currentKind,
      text,
      source: { kind: 'markdown' },
      confidence: parseConfidence(meta.confidence),
      firstSeenAt: meta.firstSeenAt || updatedAt,
      updatedAt,
    });
  }

  return dedupeAndLimit(records);
}

function parseMetadata(raw: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const [key, ...valueParts] = part.split(':');
    if (!key || valueParts.length === 0) continue;
    meta[key.trim()] = valueParts.join(':').trim();
  }
  return meta;
}

function parseConfidence(value?: string): LongTermMemoryConfidence {
  return value === 'high' ? 'high' : 'medium';
}

function readFrontmatterValue(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim();
}

function newestUpdatedAt(records: LongTermMemoryRecord[]): string | undefined {
  const sorted = records.map(record => record.updatedAt).sort();
  return sorted[sorted.length - 1];
}

function contentToString(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => block.type === 'text' ? block.text : '[图片]').join('');
}

function stripPrefix(text: string, prefix: string): string {
  return text.slice(prefix.length).trim();
}

function stableId(kind: string, value: string): string {
  return `${kind}-${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}

function sourceLabel(source: MemorySourceRef): string {
  if (source.kind === 'compact_message') return 'compact_session_memory';
  if (source.kind === 'transcript' && source.role === 'user') return 'user_message';
  return source.kind;
}

function ensureSentence(text: string): string {
  return /[。.!?]$/.test(text) ? text : `${text}。`;
}

function limitText(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}
