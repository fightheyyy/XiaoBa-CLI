import { createHash } from 'crypto';

export interface LegacyTraceFileInput {
  path: string;
  content: string;
  sizeBytes?: number;
}

export interface LegacyTraceBenchmarkOptions {
  sourceLabel?: string;
  maxCases?: number;
  includeText?: boolean;
  textPreviewChars?: number;
}

export interface LegacyTraceIssue {
  type: string;
  severity: 'high' | 'medium' | 'low';
}

export interface LegacyTraceToolStat {
  name: string;
  count: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

export interface LegacyTraceFileSummary {
  path: string;
  platform: string;
  date: string;
  lines: number;
  validJsonLines: number;
  parseErrors: number;
  turnEntries: number;
  runtimeEntries: number;
  unknownEntries: number;
  sessionHashes: string[];
  firstTimestamp: string;
  lastTimestamp: string;
  totalTokens: number;
  toolCalls: number;
  toolFailures: number;
  issueCounts: Record<string, number>;
}

export interface LegacyTraceBenchmarkCase {
  id: string;
  kind: string;
  sourcePath: string;
  platform: string;
  date: string;
  sessionHash: string;
  interactionId: number;
  startTurn: number;
  endTurn: number;
  timestamp: string;
  score: number;
  baseline: {
    turns: number;
    promptTokens: number;
    completionTokens: number;
    toolCalls: number;
    toolFailures: number;
    maxToolDurationMs: number;
    issueTypes: string[];
    toolNames: string[];
  };
  expectations: string[];
  preview?: {
    user: string;
    assistant: string;
  };
}

export interface LegacyTraceBenchmarkResult {
  version: 1;
  sourceLabel: string;
  scannedAt: string;
  summary: {
    files: number;
    lines: number;
    validJsonLines: number;
    parseErrors: number;
    parseCoverage: number;
    turnEntries: number;
    runtimeEntries: number;
    unknownEntries: number;
    platforms: Record<string, number>;
    dates: { start: string; end: string; count: number };
    sessions: number;
    interactions: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    maxPromptTokens: number;
    maxCompletionTokens: number;
    toolCalls: number;
    toolFailures: number;
    toolSuccessRate: number;
    issueCounts: Record<string, number>;
    redactionHits: number;
    benchmarkScore: number;
  };
  toolStats: LegacyTraceToolStat[];
  files: LegacyTraceFileSummary[];
  cases: LegacyTraceBenchmarkCase[];
  warnings: string[];
}

interface ParsedLine {
  file: LegacyTraceFileInput;
  lineNumber: number;
  value: Record<string, any>;
}

interface NormalizedToolCall {
  name: string;
  argumentsText: string;
  resultText: string;
  durationMs?: number;
  success: boolean;
}

interface NormalizedTurn {
  sourcePath: string;
  platform: string;
  date: string;
  timestamp: string;
  sessionId: string;
  sessionHash: string;
  turn: number;
  interactionId: number;
  userText: string;
  assistantText: string;
  promptTokens: number;
  completionTokens: number;
  tools: NormalizedToolCall[];
  issues: LegacyTraceIssue[];
}

interface RuntimeEvent {
  sourcePath: string;
  platform: string;
  date: string;
  timestamp: string;
  sessionId: string;
  sessionHash: string;
  level: string;
  message: string;
  issues: LegacyTraceIssue[];
}

interface ToolAgg {
  count: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  durationSamples: number;
  maxDurationMs: number;
}

const DEFAULT_MAX_CASES = 16;
const DEFAULT_TEXT_PREVIEW_CHARS = 160;
const FAILURE_RE = /(失败|错误|error|fail|执行被阻止|denied|blocked|not recognized|不是内部或外部命令)/i;
const NETWORK_RE = /(API调用失败|Connection error|\bENOTFOUND\b|认证失败|getaddrinfo|ECONNRESET|ETIMEDOUT)/i;
const RATE_LIMIT_RE = /(429|rate limit|too many requests|限流)/i;
const TIMEOUT_RE = /(timeout|超时)/i;
const UNIX_ON_WINDOWS_RE = /不是内部或外部命令|not recognized as an internal or external command/i;
const UNIX_COMMAND_RE = /\b(head|tail|grep|find|ls|cat|sed|awk)\b/i;
const CONTEXT_PRESSURE_PROMPT_TOKENS = 96000;
const CONTEXT_PRESSURE_TOTAL_TOKENS = 110000;
const SLOW_TOOL_MS = 10000;
const VERY_SLOW_TOOL_MS = 30000;

export function runLegacyTraceBenchmark(
  files: LegacyTraceFileInput[],
  options: LegacyTraceBenchmarkOptions = {},
): LegacyTraceBenchmarkResult {
  const maxCases = options.maxCases && options.maxCases > 0 ? Math.floor(options.maxCases) : DEFAULT_MAX_CASES;
  const textPreviewChars = options.textPreviewChars && options.textPreviewChars > 0
    ? Math.floor(options.textPreviewChars)
    : DEFAULT_TEXT_PREVIEW_CHARS;

  const parsedLines: ParsedLine[] = [];
  const fileSummaries = new Map<string, LegacyTraceFileSummary>();
  const toolAgg = new Map<string, ToolAgg>();
  const issueCounts = new Map<string, number>();
  const platforms = new Map<string, number>();
  const dates = new Set<string>();
  const sessionHashes = new Set<string>();
  const sessionStates = new Map<string, { interactionId: number; lastTurn: number }>();
  const turns: NormalizedTurn[] = [];
  const runtimeEvents: RuntimeEvent[] = [];
  const warnings: string[] = [];

  let totalLines = 0;
  let validJsonLines = 0;
  let parseErrors = 0;
  let unknownEntries = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let maxPromptTokens = 0;
  let maxCompletionTokens = 0;
  let redactionHits = 0;

  for (const file of files) {
    const metadata = inferPathMetadata(file.path);
    const summary = createFileSummary(file.path, metadata.platform, metadata.date);
    fileSummaries.set(file.path, summary);
    platforms.set(metadata.platform, (platforms.get(metadata.platform) || 0) + 1);
    if (metadata.date) dates.add(metadata.date);

    const lines = file.content.split(/\r?\n/);
    summary.lines = lines.filter(line => line.trim()).length;
    totalLines += summary.lines;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const value = JSON.parse(trimmed);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          summary.unknownEntries++;
          unknownEntries++;
          return;
        }
        summary.validJsonLines++;
        validJsonLines++;
        parsedLines.push({ file, lineNumber: index + 1, value });
      } catch {
        summary.parseErrors++;
        parseErrors++;
      }
    });
  }

  for (const item of parsedLines) {
    const metadata = inferPathMetadata(item.file.path);
    const summary = fileSummaries.get(item.file.path)!;
    const entry = item.value;
    const timestamp = safeString(entry.timestamp);
    if (timestamp) {
      if (!summary.firstTimestamp) summary.firstTimestamp = timestamp;
      summary.lastTimestamp = timestamp;
    }

    if (isTurnEntry(entry)) {
      summary.turnEntries++;
      const sessionId = safeString(entry.session_id) || `${metadata.platform}:${metadata.fileName}`;
      const sessionHash = stableHash(sessionId);
      sessionHashes.add(sessionHash);
      addUnique(summary.sessionHashes, sessionHash);

      const turnNumber = safeInteger(entry.turn, 0);
      const stateKey = `${sessionHash}:${metadata.date || ''}:${item.file.path}`;
      const state = sessionStates.get(stateKey) || { interactionId: 1, lastTurn: 0 };
      if (state.lastTurn > 0 && turnNumber > 0 && turnNumber <= state.lastTurn) {
        state.interactionId++;
      }
      if (turnNumber > 0) {
        state.lastTurn = turnNumber;
      }
      sessionStates.set(stateKey, state);

      const userText = contentToText(entry.user?.text ?? entry.user?.content ?? entry.input ?? '');
      const assistantText = contentToText(entry.assistant?.text ?? entry.assistant?.content ?? entry.output ?? '');
      const promptTokens = safeInteger(entry.tokens?.prompt ?? entry.usage?.promptTokens ?? entry.input_tokens, 0);
      const completionTokens = safeInteger(entry.tokens?.completion ?? entry.usage?.completionTokens ?? entry.output_tokens, 0);
      const tools = normalizeToolCalls(entry.assistant?.tool_calls);
      const issues = detectTurnIssues(userText, assistantText, promptTokens, completionTokens, tools);

      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;
      maxPromptTokens = Math.max(maxPromptTokens, promptTokens);
      maxCompletionTokens = Math.max(maxCompletionTokens, completionTokens);
      summary.totalTokens += promptTokens + completionTokens;
      summary.toolCalls += tools.length;
      summary.toolFailures += tools.filter(tool => !tool.success).length;

      for (const tool of tools) {
        addToolAgg(toolAgg, tool);
      }
      for (const issue of issues) {
        increment(issueCounts, issue.type);
        incrementObject(summary.issueCounts, issue.type);
      }

      const redactionProbe = [
        userText,
        assistantText,
        ...tools.flatMap(tool => [tool.argumentsText, tool.resultText]),
      ].join('\n');
      redactionHits += countRedactionHits(redactionProbe);

      turns.push({
        sourcePath: item.file.path,
        platform: safeString(entry.session_type) || metadata.platform,
        date: metadata.date,
        timestamp,
        sessionId,
        sessionHash,
        turn: turnNumber,
        interactionId: state.interactionId,
        userText,
        assistantText,
        promptTokens,
        completionTokens,
        tools,
        issues,
      });
      continue;
    }

    if (isRuntimeEntry(entry)) {
      summary.runtimeEntries++;
      const sessionId = safeString(entry.session_id) || `${metadata.platform}:${metadata.fileName}`;
      const sessionHash = stableHash(sessionId);
      sessionHashes.add(sessionHash);
      addUnique(summary.sessionHashes, sessionHash);

      const message = safeString(entry.message ?? entry.text);
      const issues = detectRuntimeIssues(safeString(entry.level), message);
      for (const issue of issues) {
        increment(issueCounts, issue.type);
        incrementObject(summary.issueCounts, issue.type);
      }
      redactionHits += countRedactionHits(message);

      const runtimeTool = normalizeRuntimeToolEvent(message);
      if (runtimeTool) {
        addRuntimeToolAgg(toolAgg, runtimeTool);
        summary.toolCalls += runtimeTool.countsAsCall ? 1 : 0;
        summary.toolFailures += runtimeTool.success === false ? 1 : 0;
      }

      const tokens = parseRuntimeTokens(message);
      if (tokens) {
        totalPromptTokens += tokens.prompt;
        totalCompletionTokens += tokens.completion;
        maxPromptTokens = Math.max(maxPromptTokens, tokens.prompt);
        maxCompletionTokens = Math.max(maxCompletionTokens, tokens.completion);
        summary.totalTokens += tokens.prompt + tokens.completion;
      }

      runtimeEvents.push({
        sourcePath: item.file.path,
        platform: safeString(entry.session_type) || metadata.platform,
        date: metadata.date,
        timestamp,
        sessionId,
        sessionHash,
        level: safeString(entry.level),
        message,
        issues,
      });
      continue;
    }

    summary.unknownEntries++;
    unknownEntries++;
  }

  for (const summary of fileSummaries.values()) {
    summary.sessionHashes.sort();
    if (summary.parseErrors > 0) {
      warnings.push(`${summary.path}: ${summary.parseErrors} JSONL lines could not be parsed`);
    }
  }

  const toolStats = Array.from(toolAgg.entries())
    .map(([name, agg]) => ({
      name,
      count: agg.count,
      successes: agg.successes,
      failures: agg.failures,
      avgDurationMs: agg.durationSamples > 0 ? Math.round(agg.totalDurationMs / agg.durationSamples) : 0,
      maxDurationMs: agg.maxDurationMs,
    }))
    .sort((a, b) => {
      if (b.failures !== a.failures) return b.failures - a.failures;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

  const issueCountsObject = toSortedRecord(issueCounts);
  const totalToolCalls = toolStats.reduce((sum, item) => sum + item.count, 0);
  const totalToolFailures = toolStats.reduce((sum, item) => sum + item.failures, 0);
  const parseCoverage = totalLines > 0 ? round(validJsonLines / totalLines, 4) : 1;
  const toolSuccessRate = totalToolCalls > 0 ? round((totalToolCalls - totalToolFailures) / totalToolCalls, 4) : 1;
  const dateValues = Array.from(dates).sort();

  const result: LegacyTraceBenchmarkResult = {
    version: 1,
    sourceLabel: options.sourceLabel || 'legacy-trace',
    scannedAt: new Date().toISOString(),
    summary: {
      files: files.length,
      lines: totalLines,
      validJsonLines,
      parseErrors,
      parseCoverage,
      turnEntries: turns.length,
      runtimeEntries: runtimeEvents.length,
      unknownEntries,
      platforms: toSortedRecord(platforms),
      dates: {
        start: dateValues[0] || '',
        end: dateValues[dateValues.length - 1] || '',
        count: dateValues.length,
      },
      sessions: sessionHashes.size,
      interactions: countInteractions(turns),
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      maxPromptTokens,
      maxCompletionTokens,
      toolCalls: totalToolCalls,
      toolFailures: totalToolFailures,
      toolSuccessRate,
      issueCounts: issueCountsObject,
      redactionHits,
      benchmarkScore: scoreTrace({
        parseCoverage,
        toolSuccessRate,
        turns: turns.length,
        toolCalls: totalToolCalls,
        slowSignals: (issueCounts.get('slow_tool') || 0) + (issueCounts.get('very_slow_tool') || 0),
        contextSignals: issueCounts.get('context_pressure') || 0,
        redactionHits,
      }),
    },
    toolStats,
    files: Array.from(fileSummaries.values()).sort((a, b) => a.path.localeCompare(b.path)),
    cases: createBenchmarkCases(turns, runtimeEvents, {
      maxCases,
      includeText: options.includeText === true,
      textPreviewChars,
    }),
    warnings,
  };

  return result;
}

export function renderLegacyTraceBenchmarkMarkdown(result: LegacyTraceBenchmarkResult): string {
  const topIssues = Object.entries(result.summary.issueCounts)
    .slice(0, 8)
    .map(([name, count]) => `- ${name}: ${count}`)
    .join('\n') || '- none';
  const topTools = result.toolStats
    .slice(0, 10)
    .map(tool => `- ${tool.name}: ${tool.count} calls, ${tool.failures} failures, avg ${tool.avgDurationMs}ms`)
    .join('\n') || '- none';
  const cases = result.cases
    .map(item => [
      `- ${item.id} (${item.kind})`,
      `  source: ${item.sourcePath}`,
      `  baseline: ${item.baseline.turns} turns, ${item.baseline.toolCalls} tool calls, ${item.baseline.toolFailures} failures, issues=${item.baseline.issueTypes.join(', ') || 'none'}`,
    ].join('\n'))
    .join('\n') || '- none';

  return [
    '# Legacy Trace Benchmark',
    '',
    `Source: ${result.sourceLabel}`,
    `Scanned at: ${result.scannedAt}`,
    `Benchmark score: ${result.summary.benchmarkScore}/100`,
    '',
    '## Summary',
    '',
    `- files: ${result.summary.files}`,
    `- lines: ${result.summary.lines}, parse coverage: ${(result.summary.parseCoverage * 100).toFixed(2)}%`,
    `- turns: ${result.summary.turnEntries}, runtime events: ${result.summary.runtimeEntries}`,
    `- platforms: ${Object.entries(result.summary.platforms).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
    `- dates: ${result.summary.dates.start || 'n/a'} to ${result.summary.dates.end || 'n/a'} (${result.summary.dates.count} days)`,
    `- sessions: ${result.summary.sessions}, interactions: ${result.summary.interactions}`,
    `- tokens: ${result.summary.totalTokens} (${result.summary.promptTokens}+${result.summary.completionTokens})`,
    `- tool calls: ${result.summary.toolCalls}, failures: ${result.summary.toolFailures}, success rate: ${(result.summary.toolSuccessRate * 100).toFixed(2)}%`,
    `- redaction hits: ${result.summary.redactionHits}`,
    '',
    '## Top Issues',
    '',
    topIssues,
    '',
    '## Top Tools',
    '',
    topTools,
    '',
    '## Benchmark Cases',
    '',
    cases,
    '',
    '## Notes',
    '',
    '- This is an offline trace-ingestion benchmark. It scores parseability, tool stability signals, context pressure, and log hygiene from existing traces.',
    '- Case previews are omitted unless the CLI is run with --include-text; previews are redacted before writing.',
    '- Raw session ids are hashed in generated benchmark cases.',
  ].join('\n');
}

function createFileSummary(path: string, platform: string, date: string): LegacyTraceFileSummary {
  return {
    path,
    platform,
    date,
    lines: 0,
    validJsonLines: 0,
    parseErrors: 0,
    turnEntries: 0,
    runtimeEntries: 0,
    unknownEntries: 0,
    sessionHashes: [],
    firstTimestamp: '',
    lastTimestamp: '',
    totalTokens: 0,
    toolCalls: 0,
    toolFailures: 0,
    issueCounts: {},
  };
}

function inferPathMetadata(inputPath: string): { platform: string; date: string; fileName: string } {
  const normalized = inputPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || normalized;
  const sessionsIndex = parts.lastIndexOf('sessions');
  const platform = sessionsIndex >= 0 && parts[sessionsIndex + 1]
    ? parts[sessionsIndex + 1]
    : 'unknown';
  const maybeDate = sessionsIndex >= 0 ? parts[sessionsIndex + 2] : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(maybeDate || '') ? maybeDate : '';
  return { platform, date, fileName };
}

function isTurnEntry(entry: Record<string, any>): boolean {
  if (entry.entry_type === 'turn') return true;
  return ('turn' in entry && ('user' in entry || 'assistant' in entry))
    || ('assistant' in entry && ('tokens' in entry || 'usage' in entry));
}

function isRuntimeEntry(entry: Record<string, any>): boolean {
  if (entry.entry_type === 'runtime') return true;
  return ('level' in entry && 'message' in entry)
    || ('message' in entry && 'session_id' in entry && !isTurnEntry(entry));
}

function normalizeToolCalls(raw: any): NormalizedToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    const name = safeString(item?.name ?? item?.function?.name) || 'unknown_tool';
    const argumentsText = stringifyForAnalysis(item?.arguments ?? item?.function?.arguments ?? {});
    const resultText = stringifyForAnalysis(item?.result ?? item?.content ?? '');
    const durationMs = safeOptionalInteger(item?.duration_ms ?? item?.durationMs);
    const success = !FAILURE_RE.test(resultText);
    return { name, argumentsText, resultText, durationMs, success };
  });
}

function detectTurnIssues(
  userText: string,
  assistantText: string,
  promptTokens: number,
  completionTokens: number,
  tools: NormalizedToolCall[],
): LegacyTraceIssue[] {
  const issues: LegacyTraceIssue[] = [];
  const allText = [userText, assistantText, ...tools.flatMap(tool => [tool.argumentsText, tool.resultText])].join('\n');

  if (!assistantText.trim() && tools.length === 0) {
    issues.push({ type: 'empty_reply', severity: 'medium' });
  }
  if (promptTokens >= CONTEXT_PRESSURE_PROMPT_TOKENS || promptTokens + completionTokens >= CONTEXT_PRESSURE_TOTAL_TOKENS) {
    issues.push({ type: 'context_pressure', severity: 'high' });
  }
  if (NETWORK_RE.test(allText)) {
    issues.push({ type: 'api_or_network_failure', severity: 'high' });
  }
  if (RATE_LIMIT_RE.test(allText)) {
    issues.push({ type: 'rate_limited_retry', severity: 'medium' });
  }
  if (TIMEOUT_RE.test(allText)) {
    issues.push({ type: 'timeout', severity: 'high' });
  }
  if (countRedactionHits(allText) > 0) {
    issues.push({ type: 'credential_exposure', severity: 'high' });
  }

  for (const tool of tools) {
    if (!tool.success) {
      issues.push({ type: 'tool_failure', severity: 'medium' });
    }
    if (tool.durationMs !== undefined && tool.durationMs >= SLOW_TOOL_MS) {
      issues.push({ type: 'slow_tool', severity: tool.durationMs >= VERY_SLOW_TOOL_MS ? 'high' : 'medium' });
    }
    if (tool.durationMs !== undefined && tool.durationMs >= VERY_SLOW_TOOL_MS) {
      issues.push({ type: 'very_slow_tool', severity: 'high' });
    }
    if (/执行被阻止: 读取路径超出工作目录/.test(tool.resultText)) {
      issues.push({ type: 'outside_read_blocked', severity: 'medium' });
    }
    if (UNIX_ON_WINDOWS_RE.test(tool.resultText) && UNIX_COMMAND_RE.test(`${tool.argumentsText} ${tool.resultText}`)) {
      issues.push({ type: 'platform_command_mismatch', severity: 'medium' });
    }
  }

  return dedupeIssues(issues);
}

function detectRuntimeIssues(level: string, message: string): LegacyTraceIssue[] {
  const issues: LegacyTraceIssue[] = [];
  const upperLevel = level.toUpperCase();
  if (upperLevel === 'ERROR' || /(^|\s)(error|失败|异常)(\s|$)/i.test(message)) {
    issues.push({ type: 'runtime_error', severity: 'high' });
  }
  if (upperLevel === 'WARN' || RATE_LIMIT_RE.test(message) || TIMEOUT_RE.test(message)) {
    issues.push({ type: 'runtime_warning', severity: RATE_LIMIT_RE.test(message) || TIMEOUT_RE.test(message) ? 'high' : 'medium' });
  }
  if (NETWORK_RE.test(message)) {
    issues.push({ type: 'api_or_network_failure', severity: 'high' });
  }
  if (countRedactionHits(message) > 0) {
    issues.push({ type: 'credential_exposure', severity: 'high' });
  }
  if (/恢复/.test(message)) {
    issues.push({ type: 'restore_event', severity: 'low' });
  }
  if (/压缩|compact/i.test(message)) {
    issues.push({ type: 'compaction_event', severity: 'low' });
  }
  return dedupeIssues(issues);
}

function normalizeRuntimeToolEvent(message: string): (NormalizedToolCall & { countsAsCall: boolean }) | undefined {
  const execMatch = message.match(/执行工具:\s*(\S+)/);
  if (execMatch) {
    return {
      name: execMatch[1],
      argumentsText: message,
      resultText: '',
      success: true,
      countsAsCall: true,
    };
  }

  const doneMatch = message.match(/工具完成:\s*(\S+)\s*\|\s*耗时:\s*(\d+)ms\s*\|\s*结果:\s*(.+)$/);
  if (!doneMatch) return undefined;
  const resultText = doneMatch[3];
  return {
    name: doneMatch[1],
    argumentsText: '',
    resultText,
    durationMs: Number(doneMatch[2]),
    success: !FAILURE_RE.test(resultText),
    countsAsCall: false,
  };
}

function parseRuntimeTokens(message: string): { prompt: number; completion: number } | undefined {
  const match = message.match(/AI返回 tokens:\s*(\d+)\+(\d+)=\d+/);
  if (!match) return undefined;
  return { prompt: Number(match[1]), completion: Number(match[2]) };
}

function addToolAgg(toolAgg: Map<string, ToolAgg>, tool: NormalizedToolCall): void {
  const agg = toolAgg.get(tool.name) || {
    count: 0,
    successes: 0,
    failures: 0,
    totalDurationMs: 0,
    durationSamples: 0,
    maxDurationMs: 0,
  };
  agg.count++;
  if (tool.success) agg.successes++;
  else agg.failures++;
  if (tool.durationMs !== undefined) {
    agg.totalDurationMs += tool.durationMs;
    agg.durationSamples++;
    agg.maxDurationMs = Math.max(agg.maxDurationMs, tool.durationMs);
  }
  toolAgg.set(tool.name, agg);
}

function addRuntimeToolAgg(toolAgg: Map<string, ToolAgg>, tool: NormalizedToolCall & { countsAsCall: boolean }): void {
  const agg = toolAgg.get(tool.name) || {
    count: 0,
    successes: 0,
    failures: 0,
    totalDurationMs: 0,
    durationSamples: 0,
    maxDurationMs: 0,
  };

  if (tool.countsAsCall) {
    agg.count++;
  } else {
    if (agg.count === 0) {
      agg.count++;
    }
    if (tool.success) agg.successes++;
    else agg.failures++;
  }

  if (tool.durationMs !== undefined) {
    agg.totalDurationMs += tool.durationMs;
    agg.durationSamples++;
    agg.maxDurationMs = Math.max(agg.maxDurationMs, tool.durationMs);
  }

  toolAgg.set(tool.name, agg);
}

function createBenchmarkCases(
  turns: NormalizedTurn[],
  runtimeEvents: RuntimeEvent[],
  options: { maxCases: number; includeText: boolean; textPreviewChars: number },
): LegacyTraceBenchmarkCase[] {
  const turnCandidates = turns.map(turn => {
    const issueTypes = unique(turn.issues.map(issue => issue.type));
    const maxToolDurationMs = turn.tools.reduce((max, tool) => Math.max(max, tool.durationMs || 0), 0);
    const kind = classifyTurnCase(turn, issueTypes);
    const score = scoreTurnCase(turn, issueTypes, maxToolDurationMs);
    const expectations = expectationsForCase(kind, issueTypes);
    const item: LegacyTraceBenchmarkCase = {
      id: `legacy-${stableHash(`${turn.sourcePath}:${turn.sessionHash}:${turn.interactionId}:${turn.turn}:${kind}`, 14)}`,
      kind,
      sourcePath: turn.sourcePath,
      platform: turn.platform,
      date: turn.date,
      sessionHash: turn.sessionHash,
      interactionId: turn.interactionId,
      startTurn: turn.turn,
      endTurn: turn.turn,
      timestamp: turn.timestamp,
      score,
      baseline: {
        turns: 1,
        promptTokens: turn.promptTokens,
        completionTokens: turn.completionTokens,
        toolCalls: turn.tools.length,
        toolFailures: turn.tools.filter(tool => !tool.success).length,
        maxToolDurationMs,
        issueTypes,
        toolNames: unique(turn.tools.map(tool => tool.name)).sort(),
      },
      expectations,
    };
    if (options.includeText) {
      item.preview = {
        user: redactSensitiveText(truncatePlain(turn.userText, options.textPreviewChars)),
        assistant: redactSensitiveText(truncatePlain(turn.assistantText, options.textPreviewChars)),
      };
    }
    return item;
  });

  const runtimeCandidates = runtimeEvents
    .filter(event => event.issues.length > 0)
    .map(event => {
      const issueTypes = unique(event.issues.map(issue => issue.type));
      const kind = issueTypes.includes('restore_event') ? 'runtime_restore' : 'runtime_signal';
      const item: LegacyTraceBenchmarkCase = {
        id: `legacy-${stableHash(`${event.sourcePath}:${event.sessionHash}:${event.timestamp}:${kind}`, 14)}`,
        kind,
        sourcePath: event.sourcePath,
        platform: event.platform,
        date: event.date,
        sessionHash: event.sessionHash,
        interactionId: 0,
        startTurn: 0,
        endTurn: 0,
        timestamp: event.timestamp,
        score: issueTypes.includes('credential_exposure') ? 80 : 35 + issueTypes.length * 5,
        baseline: {
          turns: 0,
          promptTokens: 0,
          completionTokens: 0,
          toolCalls: 0,
          toolFailures: 0,
          maxToolDurationMs: 0,
          issueTypes,
          toolNames: [],
        },
        expectations: expectationsForCase(kind, issueTypes),
      };
      if (options.includeText) {
        item.preview = {
          user: '',
          assistant: redactSensitiveText(truncatePlain(event.message, options.textPreviewChars)),
        };
      }
      return item;
    });

  const selected: LegacyTraceBenchmarkCase[] = [];
  const perKind = new Map<string, number>();
  const perSource = new Map<string, number>();

  for (const candidate of [...turnCandidates, ...runtimeCandidates].sort((a, b) => b.score - a.score)) {
    if (selected.length >= options.maxCases) break;
    const kindCount = perKind.get(candidate.kind) || 0;
    const sourceCount = perSource.get(candidate.sourcePath) || 0;
    if (kindCount >= 3 || sourceCount >= 2) continue;
    selected.push(candidate);
    perKind.set(candidate.kind, kindCount + 1);
    perSource.set(candidate.sourcePath, sourceCount + 1);
  }

  if (selected.length < options.maxCases) {
    for (const candidate of [...turnCandidates, ...runtimeCandidates].sort((a, b) => b.score - a.score)) {
      if (selected.length >= options.maxCases) break;
      if (selected.some(item => item.id === candidate.id)) continue;
      selected.push(candidate);
    }
  }

  return selected.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath);
    return a.startTurn - b.startTurn;
  });
}

function classifyTurnCase(turn: NormalizedTurn, issueTypes: string[]): string {
  if (issueTypes.includes('credential_exposure')) return 'log_hygiene_redaction';
  if (issueTypes.includes('context_pressure')) return 'context_pressure';
  if (issueTypes.includes('platform_command_mismatch')) return 'platform_command_mismatch';
  if (issueTypes.includes('api_or_network_failure')) return 'network_failure_recovery';
  if (issueTypes.includes('rate_limited_retry')) return 'rate_limit_recovery';
  if (issueTypes.includes('slow_tool') || issueTypes.includes('very_slow_tool')) return 'slow_tool_observability';
  if (turn.tools.some(tool => tool.name === 'send_file')) return 'artifact_delivery';
  if (turn.tools.some(tool => /browser|agent-browser|playwright|selenium/i.test(`${tool.name} ${tool.argumentsText}`))) return 'browser_recovery';
  if (turn.tools.length >= 5) return 'multi_tool_task';
  if (turn.promptTokens >= 40000) return 'large_context_task';
  if (turn.tools.length > 0) return 'tool_turn';
  return 'dialog_turn';
}

function scoreTurnCase(turn: NormalizedTurn, issueTypes: string[], maxToolDurationMs: number): number {
  return Math.round(
    turn.tools.length * 6
    + issueTypes.length * 15
    + Math.min(25, turn.promptTokens / 4000)
    + Math.min(20, maxToolDurationMs / 3000)
    + (turn.tools.some(tool => tool.name === 'send_file') ? 12 : 0),
  );
}

function expectationsForCase(kind: string, issueTypes: string[]): string[] {
  const expectations = [
    'legacy JSONL can be normalized without losing turn, token, and tool-call counts',
    'generated benchmark output must not contain raw credentials or private host secrets',
  ];

  if (kind === 'context_pressure' || issueTypes.includes('context_pressure')) {
    expectations.push('current context compressor keeps provider payload under the configured budget');
  }
  if (kind === 'platform_command_mismatch' || issueTypes.includes('platform_command_mismatch')) {
    expectations.push('current runtime chooses commands compatible with the active OS/shell');
  }
  if (kind === 'network_failure_recovery' || issueTypes.includes('api_or_network_failure')) {
    expectations.push('network or provider failures are surfaced as recoverable, observable state');
  }
  if (kind === 'rate_limit_recovery' || issueTypes.includes('rate_limited_retry')) {
    expectations.push('rate-limit retries include visible backoff or a clear blocked reason');
  }
  if (kind === 'slow_tool_observability' || issueTypes.includes('slow_tool')) {
    expectations.push('slow tools leave duration evidence and do not look like silent hangs');
  }
  if (kind === 'artifact_delivery') {
    expectations.push('artifact delivery records the sent file path/name and final user-visible confirmation');
  }
  if (kind === 'browser_recovery') {
    expectations.push('browser fallback path is explicit when the preferred browser harness is unavailable');
  }

  return unique(expectations);
}

export function redactSensitiveText(input: string): string {
  let output = input;
  output = output.replace(/("?(?:password|passwd|passphrase|api[_-]?key|secret|token|authorization)"?\s*[:=]\s*)"[^"\n\r]*"/gi, '$1"[REDACTED]"');
  output = output.replace(/("?(?:password|passwd|passphrase|api[_-]?key|secret|token|authorization)"?\s*[:=]\s*)'[^'\n\r]*'/gi, "$1'[REDACTED]'");
  output = output.replace(/(\bsshpass(?:\.exe)?\b[\s\S]{0,120}?\s-p\s+)'[^'\n\r]+'/gi, "$1'[REDACTED]'");
  output = output.replace(/(\bsshpass(?:\.exe)?\b[\s\S]{0,120}?\s-p\s+)"[^"\n\r]+"/gi, '$1"[REDACTED]"');
  output = output.replace(/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}\b/g, '[PRIVATE_IP]');
  output = output.replace(/C:\\Users\\[^\\\s"]+/gi, 'C:\\Users\\[USER]');
  output = output.replace(/\/(?:Users|home|share\/home)\/[^/\s"]+/g, match => {
    const prefix = match.startsWith('/share/home/') ? '/share/home' : match.startsWith('/Users/') ? '/Users' : '/home';
    return `${prefix}/[USER]`;
  });
  return output;
}

function countRedactionHits(input: string): number {
  let hits = 0;
  const patterns = [
    /"?(?:password|passwd|passphrase|api[_-]?key|secret|token|authorization)"?\s*[:=]\s*["'][^"'\n\r]+["']/gi,
    /\bsshpass(?:\.exe)?\b[\s\S]{0,120}?\s-p\s+["'][^"'\n\r]+["']/gi,
  ];
  for (const pattern of patterns) {
    const matches = input.match(pattern);
    if (matches) hits += matches.length;
  }
  return hits;
}

function scoreTrace(input: {
  parseCoverage: number;
  toolSuccessRate: number;
  turns: number;
  toolCalls: number;
  slowSignals: number;
  contextSignals: number;
  redactionHits: number;
}): number {
  const parseScore = input.parseCoverage * 35;
  const toolScore = input.toolSuccessRate * 25;
  const slowRate = input.toolCalls > 0 ? input.slowSignals / input.toolCalls : 0;
  const latencyScore = Math.max(0, 15 * (1 - slowRate * 3));
  const contextRate = input.turns > 0 ? input.contextSignals / input.turns : 0;
  const contextScore = Math.max(0, 15 * (1 - contextRate * 8));
  const hygieneScore = input.redactionHits > 0 ? 0 : 10;
  return Math.max(0, Math.min(100, Math.round(parseScore + toolScore + latencyScore + contextScore + hygieneScore)));
}

function countInteractions(turns: NormalizedTurn[]): number {
  const keys = new Set<string>();
  for (const turn of turns) {
    keys.add(`${turn.sessionHash}:${turn.sourcePath}:${turn.interactionId}`);
  }
  return keys.size;
}

function contentToText(value: any): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text' && typeof item.text === 'string') return item.text;
      if (item?.type === 'image') return '[image]';
      return stringifyForAnalysis(item);
    }).join('');
  }
  return stringifyForAnalysis(value);
}

function stringifyForAnalysis(value: any): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeString(value: any): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function safeInteger(value: any, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function safeOptionalInteger(value: any): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

function stableHash(value: string, length = 12): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function truncatePlain(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 3))}...`;
}

function dedupeIssues(issues: LegacyTraceIssue[]): LegacyTraceIssue[] {
  const seen = new Set<string>();
  const result: LegacyTraceIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.type)) continue;
    seen.add(issue.type);
    result.push(issue);
  }
  return result;
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) || 0) + amount);
}

function incrementObject(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] || 0) + amount;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toSortedRecord(input: Map<string, number>): Record<string, number> {
  return Object.fromEntries(Array.from(input.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  }));
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
