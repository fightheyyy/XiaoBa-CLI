import { createHash } from 'crypto';

export interface LegacyTraceFileInput {
  path: string;
  content: string;
  sizeBytes?: number;
}

export interface LegacyTraceBenchmarkOptions {
  sourceLabel?: string;
  benchmarkName?: string;
  domain?: string;
  domainSubtype?: string;
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

export type LegacyTraceCaseCategory = 'runtime_case' | 'skill_case' | 'hybrid_case';

export interface LegacyTraceEpisode {
  episodeId: string;
  benchmark: string;
  sourceSessionHash: string;
  sourcePaths: string[];
  platform: string;
  date: string;
  interactionId: number;
  startTurn: number;
  endTurn: number;
  turnCount: number;
  startTimestamp: string;
  endTimestamp: string;
  taskSummary: string;
  taskType: string;
  domain: string;
  domainSubtype: string;
  toolsUsed: string[];
  skillsTriggered: string[];
  toolCallCount: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  toolSuccessRate: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  maxToolDurationMs: number;
  artifactsObserved: string[];
  failureModesObserved: string[];
  contextPressure: boolean;
  requiresArtifact: boolean;
  requiresLongContext: boolean;
  requiresRemoteFixture: boolean;
  privacyLevel: 'redacted';
  runtimeEventCount: number;
  preview?: {
    user: string;
    assistant: string;
  };
}

export interface LegacyTraceDatasetCard {
  benchmark: string;
  sourceLabel: string;
  scannedAt: string;
  privacyLevel: 'redacted';
  sessions: number;
  episodes: number;
  turns: number;
  runtimeEvents: number;
  toolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  toolSuccessRate: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgTokensPerEpisode: number;
  p50TokensPerEpisode: number;
  p90TokensPerEpisode: number;
  maxTokensPerEpisode: number;
  avgTurnsPerEpisode: number;
  p50TurnsPerEpisode: number;
  p90TurnsPerEpisode: number;
  avgToolCallsPerEpisode: number;
  p50ToolCallsPerEpisode: number;
  p90ToolCallsPerEpisode: number;
  taskTypeDistribution: Record<string, number>;
  caseCategoryDistribution: Record<string, number>;
  skillTriggerDistribution: Record<string, number>;
  failureModeDistribution: Record<string, number>;
}

export interface LegacyTraceBenchmarkCase {
  id: string;
  sourceEpisodeId: string;
  benchmark: string;
  kind: string;
  caseCategory: LegacyTraceCaseCategory;
  taskType: string;
  domain: string;
  domainSubtype: string;
  sourcePath: string;
  platform: string;
  date: string;
  sessionHash: string;
  interactionId: number;
  startTurn: number;
  endTurn: number;
  timestamp: string;
  score: number;
  skillsTriggered: string[];
  successfulToolCalls: number;
  failedToolCalls: number;
  toolSuccessRate: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requiresArtifact: boolean;
  requiresLongContext: boolean;
  requiresRemoteFixture: boolean;
  privacyLevel: 'redacted';
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
  artifactsObserved: string[];
  failureModesObserved: string[];
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
    episodes: number;
    avgTurnsPerEpisode: number;
    p50TurnsPerEpisode: number;
    p90TurnsPerEpisode: number;
    avgToolCallsPerEpisode: number;
    p50ToolCallsPerEpisode: number;
    p90ToolCallsPerEpisode: number;
    avgTokensPerEpisode: number;
    p50TokensPerEpisode: number;
    p90TokensPerEpisode: number;
    maxTokensPerEpisode: number;
    taskTypeDistribution: Record<string, number>;
    caseCategoryDistribution: Record<string, number>;
    skillTriggerDistribution: Record<string, number>;
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
  episodes: LegacyTraceEpisode[];
  datasetCard: LegacyTraceDatasetCard;
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
  status: string;
  errorCode: string;
  artifactPaths: string[];
  skillId: string;
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
const EPISODE_GAP_MS = 30 * 60 * 1000;
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
  const benchmarkName = options.benchmarkName || 'LegacyTraceBenchmark';
  const domain = options.domain || 'general';
  const domainSubtype = options.domainSubtype || 'legacy_runtime_trace';
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
  const episodes = extractEpisodes(turns, runtimeEvents, {
    benchmarkName,
    domain,
    domainSubtype,
    includeText: options.includeText === true,
    textPreviewChars,
  });
  const cases = createBenchmarkCases(episodes, {
    maxCases,
    includeText: options.includeText === true,
    textPreviewChars,
  });
  const datasetCard = createDatasetCard({
    benchmarkName,
    sourceLabel: options.sourceLabel || 'legacy-trace',
    scannedAt: new Date().toISOString(),
    sessions: sessionHashes.size,
    turns: turns.length,
    runtimeEvents: runtimeEvents.length,
    episodes,
  });

  const result: LegacyTraceBenchmarkResult = {
    version: 1,
    sourceLabel: options.sourceLabel || 'legacy-trace',
    scannedAt: datasetCard.scannedAt,
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
      episodes: episodes.length,
      avgTurnsPerEpisode: datasetCard.avgTurnsPerEpisode,
      p50TurnsPerEpisode: datasetCard.p50TurnsPerEpisode,
      p90TurnsPerEpisode: datasetCard.p90TurnsPerEpisode,
      avgToolCallsPerEpisode: datasetCard.avgToolCallsPerEpisode,
      p50ToolCallsPerEpisode: datasetCard.p50ToolCallsPerEpisode,
      p90ToolCallsPerEpisode: datasetCard.p90ToolCallsPerEpisode,
      avgTokensPerEpisode: datasetCard.avgTokensPerEpisode,
      p50TokensPerEpisode: datasetCard.p50TokensPerEpisode,
      p90TokensPerEpisode: datasetCard.p90TokensPerEpisode,
      maxTokensPerEpisode: datasetCard.maxTokensPerEpisode,
      taskTypeDistribution: datasetCard.taskTypeDistribution,
      caseCategoryDistribution: datasetCard.caseCategoryDistribution,
      skillTriggerDistribution: datasetCard.skillTriggerDistribution,
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
    episodes,
    datasetCard,
    cases,
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
      `- ${item.id} (${item.caseCategory}/${item.kind})`,
      `  source: ${item.sourcePath}`,
      `  episode: ${item.sourceEpisodeId}, task=${item.taskType}, skills=${item.skillsTriggered.join(', ') || 'none'}`,
      `  baseline: ${item.baseline.turns} turns, ${item.baseline.toolCalls} tool calls, ${item.baseline.toolFailures} failures, tokens=${item.totalTokens}, successRate=${(item.toolSuccessRate * 100).toFixed(2)}%, issues=${item.baseline.issueTypes.join(', ') || 'none'}`,
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
    `- turns: ${result.summary.turnEntries}, runtime events: ${result.summary.runtimeEntries}, episodes: ${result.summary.episodes}`,
    `- turns/episode: avg ${result.summary.avgTurnsPerEpisode}, p50 ${result.summary.p50TurnsPerEpisode}, p90 ${result.summary.p90TurnsPerEpisode}`,
    `- tool calls/episode: avg ${result.summary.avgToolCallsPerEpisode}, p50 ${result.summary.p50ToolCallsPerEpisode}, p90 ${result.summary.p90ToolCallsPerEpisode}`,
    `- tokens/episode: avg ${result.summary.avgTokensPerEpisode}, p50 ${result.summary.p50TokensPerEpisode}, p90 ${result.summary.p90TokensPerEpisode}, max ${result.summary.maxTokensPerEpisode}`,
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

export function renderLegacyTraceDatasetCardMarkdown(result: LegacyTraceBenchmarkResult): string {
  const card = result.datasetCard;
  const taskTypes = Object.entries(card.taskTypeDistribution)
    .map(([name, count]) => `- ${name}: ${count}`)
    .join('\n') || '- none';
  const categories = Object.entries(card.caseCategoryDistribution)
    .map(([name, count]) => `- ${name}: ${count}`)
    .join('\n') || '- none';
  const skills = Object.entries(card.skillTriggerDistribution)
    .map(([name, count]) => `- ${name}: ${count}`)
    .join('\n') || '- none';
  const failures = Object.entries(card.failureModeDistribution)
    .slice(0, 12)
    .map(([name, count]) => `- ${name}: ${count}`)
    .join('\n') || '- none';

  return [
    `# ${card.benchmark} Dataset Card`,
    '',
    `Source: ${card.sourceLabel}`,
    `Scanned at: ${card.scannedAt}`,
    `Privacy level: ${card.privacyLevel}`,
    '',
    '## Scale',
    '',
    `- sessions: ${card.sessions}`,
    `- episodes: ${card.episodes}`,
    `- turns: ${card.turns}`,
    `- runtime events: ${card.runtimeEvents}`,
    `- tool calls: ${card.toolCalls}`,
    `- successful tool calls: ${card.successfulToolCalls}`,
    `- failed tool calls: ${card.failedToolCalls}`,
    `- tool success rate: ${(card.toolSuccessRate * 100).toFixed(2)}%`,
    `- tokens: ${card.totalTokens} (${card.promptTokens}+${card.completionTokens})`,
    '',
    '## Episode Shape',
    '',
    `- turns per episode: avg ${card.avgTurnsPerEpisode}, p50 ${card.p50TurnsPerEpisode}, p90 ${card.p90TurnsPerEpisode}`,
    `- tool calls per episode: avg ${card.avgToolCallsPerEpisode}, p50 ${card.p50ToolCallsPerEpisode}, p90 ${card.p90ToolCallsPerEpisode}`,
    `- tokens per episode: avg ${card.avgTokensPerEpisode}, p50 ${card.p50TokensPerEpisode}, p90 ${card.p90TokensPerEpisode}, max ${card.maxTokensPerEpisode}`,
    '',
    '## Task Types',
    '',
    taskTypes,
    '',
    '## Case Categories',
    '',
    categories,
    '',
    '## Skill Triggers',
    '',
    skills,
    '',
    '## Failure Modes',
    '',
    failures,
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
    const status = safeString(item?.status);
    const errorCode = safeString(item?.error_code ?? item?.errorCode);
    const artifactPaths = normalizeArtifactManifest(item?.artifact_manifest);
    const skillId = safeString(item?.skill_id ?? item?.skillId ?? item?.active_skill_name);
    const success = status ? status !== 'failure' : !FAILURE_RE.test(resultText);
    return { name, argumentsText, resultText, durationMs, success, status, errorCode, artifactPaths, skillId };
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
    const errorIssue = issueFromErrorCode(tool.errorCode);
    if (errorIssue) {
      issues.push(errorIssue);
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
      status: 'success',
      errorCode: '',
      artifactPaths: [],
      skillId: '',
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
    status: FAILURE_RE.test(resultText) ? 'failure' : 'success',
    errorCode: '',
    artifactPaths: [],
    skillId: '',
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

interface EpisodeExtractionOptions {
  benchmarkName: string;
  domain: string;
  domainSubtype: string;
  includeText: boolean;
  textPreviewChars: number;
}

type LegacyTraceEpisodeDraft = Omit<LegacyTraceEpisode, 'episodeId'>;

function extractEpisodes(
  turns: NormalizedTurn[],
  runtimeEvents: RuntimeEvent[],
  options: EpisodeExtractionOptions,
): LegacyTraceEpisode[] {
  const turnGroups = new Map<string, NormalizedTurn[]>();
  const runtimeGroups = new Map<string, RuntimeEvent[]>();

  for (const turn of turns.slice().sort(compareTurns)) {
    const key = turnGroupKey(turn);
    const items = turnGroups.get(key) || [];
    items.push(turn);
    turnGroups.set(key, items);
  }

  for (const event of runtimeEvents.slice().sort(compareRuntimeEvents)) {
    const key = runtimeGroupKey(event);
    const items = runtimeGroups.get(key) || [];
    items.push(event);
    runtimeGroups.set(key, items);
  }

  const drafts: LegacyTraceEpisodeDraft[] = [];
  for (const groupTurns of turnGroups.values()) {
    let current: NormalizedTurn[] = [];
    for (const turn of groupTurns) {
      const previous = current[current.length - 1];
      if (previous && shouldStartNewEpisode(previous, turn, current)) {
        drafts.push(buildTurnEpisodeDraft(current, runtimeGroups.get(runtimeGroupKeyFromTurn(previous)) || [], options));
        current = [];
      }
      current.push(turn);
    }
    if (current.length > 0) {
      drafts.push(buildTurnEpisodeDraft(current, runtimeGroups.get(runtimeGroupKeyFromTurn(current[0])) || [], options));
    }
  }

  const turnRuntimeKeys = new Set(turns.map(runtimeGroupKeyFromTurn));
  for (const [key, events] of runtimeGroups.entries()) {
    if (turnRuntimeKeys.has(key)) continue;
    const issueEvents = events.filter(event => event.issues.length > 0 || normalizeRuntimeToolEvent(event.message));
    for (const chunk of splitRuntimeEvents(issueEvents)) {
      if (chunk.length > 0) {
        drafts.push(buildRuntimeEpisodeDraft(chunk, options));
      }
    }
  }

  return drafts
    .sort(compareEpisodeDrafts)
    .map((draft, index) => ({
      episodeId: `${slugifyBenchmarkName(options.benchmarkName)}.ep.${String(index + 1).padStart(6, '0')}`,
      ...draft,
    }));
}

function buildTurnEpisodeDraft(
  turns: NormalizedTurn[],
  sameSessionRuntimeEvents: RuntimeEvent[],
  options: EpisodeExtractionOptions,
): LegacyTraceEpisodeDraft {
  const first = turns[0];
  const last = turns[turns.length - 1];
  const runtimeEvents = selectRuntimeEventsForTurns(sameSessionRuntimeEvents, turns);
  const issueTypes = unique([
    ...turns.flatMap(turn => turn.issues.map(issue => issue.type)),
    ...runtimeEvents.flatMap(event => event.issues.map(issue => issue.type)),
  ]).sort();
  const toolsUsed = unique(turns.flatMap(turn => turn.tools.map(tool => tool.name))).sort();
  const textForSignals = [
    ...turns.flatMap(turn => [
      turn.userText,
      turn.assistantText,
      ...turn.tools.flatMap(tool => [tool.argumentsText, tool.resultText]),
    ]),
    ...runtimeEvents.map(event => event.message),
  ].join('\n');
  const skillsTriggered = unique(turns.flatMap(turn => turn.tools.flatMap(extractSkillsFromTool))).sort();
  const artifactsObserved = unique([
    ...turns.flatMap(turn => turn.tools.flatMap(tool => tool.artifactPaths)),
    ...extractArtifactsFromText(textForSignals),
  ]).sort();
  const promptTokens = turns.reduce((sum, turn) => sum + turn.promptTokens, 0);
  const completionTokens = turns.reduce((sum, turn) => sum + turn.completionTokens, 0);
  const totalTokens = promptTokens + completionTokens;
  const toolCallCount = turns.reduce((sum, turn) => sum + turn.tools.length, 0);
  const failedToolCalls = turns.reduce((sum, turn) => sum + turn.tools.filter(tool => !tool.success).length, 0);
  const successfulToolCalls = Math.max(0, toolCallCount - failedToolCalls);
  const maxToolDurationMs = turns.reduce(
    (max, turn) => Math.max(max, ...turn.tools.map(tool => tool.durationMs || 0)),
    0,
  );
  const taskType = classifyEpisodeTask(textForSignals, issueTypes, toolsUsed, artifactsObserved);
  const requiresLongContext = issueTypes.includes('context_pressure') || promptTokens >= 40000;
  const requiresArtifact = artifactsObserved.length > 0
    || toolsUsed.includes('send_file')
    || taskType === 'plot_generation'
    || taskType === 'artifact_delivery';
  const requiresRemoteFixture = needsRemoteFixture(textForSignals, toolsUsed, options.domain);

  const draft: LegacyTraceEpisodeDraft = {
    benchmark: options.benchmarkName,
    sourceSessionHash: first.sessionHash,
    sourcePaths: unique(turns.map(turn => turn.sourcePath)).sort(),
    platform: first.platform,
    date: first.date,
    interactionId: first.interactionId,
    startTurn: first.turn,
    endTurn: last.turn,
    turnCount: turns.length,
    startTimestamp: first.timestamp,
    endTimestamp: last.timestamp,
    taskSummary: summarizeEpisodeTask(turns),
    taskType,
    domain: options.domain,
    domainSubtype: options.domainSubtype,
    toolsUsed,
    skillsTriggered,
    toolCallCount,
    successfulToolCalls,
    failedToolCalls,
    toolSuccessRate: toolCallCount > 0 ? round(successfulToolCalls / toolCallCount, 4) : 1,
    totalTokens,
    promptTokens,
    completionTokens,
    maxToolDurationMs,
    artifactsObserved,
    failureModesObserved: issueTypes,
    contextPressure: issueTypes.includes('context_pressure'),
    requiresArtifact,
    requiresLongContext,
    requiresRemoteFixture,
    privacyLevel: 'redacted',
    runtimeEventCount: runtimeEvents.length,
  };

  if (options.includeText) {
    draft.preview = {
      user: redactSensitiveText(truncatePlain(first.userText, options.textPreviewChars)),
      assistant: redactSensitiveText(truncatePlain(first.assistantText, options.textPreviewChars)),
    };
  }

  return draft;
}

function buildRuntimeEpisodeDraft(
  runtimeEvents: RuntimeEvent[],
  options: EpisodeExtractionOptions,
): LegacyTraceEpisodeDraft {
  const first = runtimeEvents[0];
  const last = runtimeEvents[runtimeEvents.length - 1];
  const issueTypes = unique(runtimeEvents.flatMap(event => event.issues.map(issue => issue.type))).sort();
  const textForSignals = runtimeEvents.map(event => event.message).join('\n');
  const runtimeTools = summarizeRuntimeTools(runtimeEvents);
  const runtimeTokens = summarizeRuntimeTokens(runtimeEvents);
  const artifactsObserved = extractArtifactsFromText(textForSignals);
  const taskType = issueTypes.includes('restore_event')
    ? 'runtime_restore'
    : issueTypes.includes('compaction_event')
      ? 'context_compaction'
      : classifyEpisodeTask(textForSignals, issueTypes, runtimeTools.toolNames, artifactsObserved);

  const draft: LegacyTraceEpisodeDraft = {
    benchmark: options.benchmarkName,
    sourceSessionHash: first.sessionHash,
    sourcePaths: unique(runtimeEvents.map(event => event.sourcePath)).sort(),
    platform: first.platform,
    date: first.date,
    interactionId: 0,
    startTurn: 0,
    endTurn: 0,
    turnCount: 0,
    startTimestamp: first.timestamp,
    endTimestamp: last.timestamp,
    taskSummary: summarizeRuntimeEpisode(runtimeEvents),
    taskType,
    domain: options.domain,
    domainSubtype: options.domainSubtype,
    toolsUsed: runtimeTools.toolNames,
    skillsTriggered: [],
    toolCallCount: runtimeTools.toolCallCount,
    successfulToolCalls: runtimeTools.successfulToolCalls,
    failedToolCalls: runtimeTools.failedToolCalls,
    toolSuccessRate: runtimeTools.toolCallCount > 0
      ? round(runtimeTools.successfulToolCalls / runtimeTools.toolCallCount, 4)
      : 1,
    totalTokens: runtimeTokens.promptTokens + runtimeTokens.completionTokens,
    promptTokens: runtimeTokens.promptTokens,
    completionTokens: runtimeTokens.completionTokens,
    maxToolDurationMs: runtimeTools.maxToolDurationMs,
    artifactsObserved,
    failureModesObserved: issueTypes,
    contextPressure: issueTypes.includes('context_pressure') || issueTypes.includes('compaction_event'),
    requiresArtifact: artifactsObserved.length > 0 || runtimeTools.toolNames.includes('send_file'),
    requiresLongContext: issueTypes.includes('context_pressure') || issueTypes.includes('compaction_event'),
    requiresRemoteFixture: needsRemoteFixture(textForSignals, runtimeTools.toolNames, options.domain),
    privacyLevel: 'redacted',
    runtimeEventCount: runtimeEvents.length,
  };

  if (options.includeText) {
    draft.preview = {
      user: '',
      assistant: redactSensitiveText(truncatePlain(first.message, options.textPreviewChars)),
    };
  }

  return draft;
}

function createDatasetCard(input: {
  benchmarkName: string;
  sourceLabel: string;
  scannedAt: string;
  sessions: number;
  turns: number;
  runtimeEvents: number;
  episodes: LegacyTraceEpisode[];
}): LegacyTraceDatasetCard {
  const turnsPerEpisode = input.episodes.map(episode => episode.turnCount);
  const toolCallsPerEpisode = input.episodes.map(episode => episode.toolCallCount);
  const tokensPerEpisode = input.episodes.map(episode => episode.totalTokens);
  const toolCalls = input.episodes.reduce((sum, episode) => sum + episode.toolCallCount, 0);
  const failedToolCalls = input.episodes.reduce((sum, episode) => sum + episode.failedToolCalls, 0);
  const successfulToolCalls = input.episodes.reduce((sum, episode) => sum + episode.successfulToolCalls, 0);
  const promptTokens = input.episodes.reduce((sum, episode) => sum + episode.promptTokens, 0);
  const completionTokens = input.episodes.reduce((sum, episode) => sum + episode.completionTokens, 0);

  return {
    benchmark: input.benchmarkName,
    sourceLabel: input.sourceLabel,
    scannedAt: input.scannedAt,
    privacyLevel: 'redacted',
    sessions: input.sessions,
    episodes: input.episodes.length,
    turns: input.turns,
    runtimeEvents: input.runtimeEvents,
    toolCalls,
    successfulToolCalls,
    failedToolCalls,
    toolSuccessRate: toolCalls > 0 ? round(successfulToolCalls / toolCalls, 4) : 1,
    totalTokens: promptTokens + completionTokens,
    promptTokens,
    completionTokens,
    avgTokensPerEpisode: average(tokensPerEpisode),
    p50TokensPerEpisode: percentile(tokensPerEpisode, 0.5),
    p90TokensPerEpisode: percentile(tokensPerEpisode, 0.9),
    maxTokensPerEpisode: maxValue(tokensPerEpisode),
    avgTurnsPerEpisode: average(turnsPerEpisode),
    p50TurnsPerEpisode: percentile(turnsPerEpisode, 0.5),
    p90TurnsPerEpisode: percentile(turnsPerEpisode, 0.9),
    avgToolCallsPerEpisode: average(toolCallsPerEpisode),
    p50ToolCallsPerEpisode: percentile(toolCallsPerEpisode, 0.5),
    p90ToolCallsPerEpisode: percentile(toolCallsPerEpisode, 0.9),
    taskTypeDistribution: countValues(input.episodes.map(episode => episode.taskType)),
    caseCategoryDistribution: countValues(input.episodes.map(episode => classifyEpisodeCaseCategory(episode))),
    skillTriggerDistribution: countValues(input.episodes.flatMap(episode => episode.skillsTriggered)),
    failureModeDistribution: countValues(input.episodes.flatMap(episode => episode.failureModesObserved)),
  };
}

function createBenchmarkCases(
  episodes: LegacyTraceEpisode[],
  options: { maxCases: number; includeText: boolean; textPreviewChars: number },
): LegacyTraceBenchmarkCase[] {
  const candidates = episodes.map(episode => {
    const issueTypes = episode.failureModesObserved;
    const kind = kindForEpisode(episode);
    const score = scoreEpisodeCase(episode);
    const caseCategory = classifyEpisodeCaseCategory(episode);
    const item: LegacyTraceBenchmarkCase = {
      id: episode.episodeId.replace('.ep.', '.case.'),
      sourceEpisodeId: episode.episodeId,
      benchmark: episode.benchmark,
      kind,
      caseCategory,
      taskType: episode.taskType,
      domain: episode.domain,
      domainSubtype: episode.domainSubtype,
      sourcePath: episode.sourcePaths[0] || '',
      platform: episode.platform,
      date: episode.date,
      sessionHash: episode.sourceSessionHash,
      interactionId: episode.interactionId,
      startTurn: episode.startTurn,
      endTurn: episode.endTurn,
      timestamp: episode.startTimestamp,
      score,
      skillsTriggered: episode.skillsTriggered,
      successfulToolCalls: episode.successfulToolCalls,
      failedToolCalls: episode.failedToolCalls,
      toolSuccessRate: episode.toolSuccessRate,
      totalTokens: episode.totalTokens,
      promptTokens: episode.promptTokens,
      completionTokens: episode.completionTokens,
      requiresArtifact: episode.requiresArtifact,
      requiresLongContext: episode.requiresLongContext,
      requiresRemoteFixture: episode.requiresRemoteFixture,
      privacyLevel: 'redacted',
      baseline: {
        turns: episode.turnCount,
        promptTokens: episode.promptTokens,
        completionTokens: episode.completionTokens,
        toolCalls: episode.toolCallCount,
        toolFailures: episode.failedToolCalls,
        maxToolDurationMs: episode.maxToolDurationMs,
        issueTypes,
        toolNames: episode.toolsUsed,
      },
      artifactsObserved: episode.artifactsObserved,
      failureModesObserved: issueTypes,
      expectations: expectationsForCase(kind, issueTypes, episode),
    };
    if (options.includeText && episode.preview) {
      item.preview = episode.preview;
    }
    return item;
  });

  const selected: LegacyTraceBenchmarkCase[] = [];
  const perCategory = new Map<string, number>();
  const perKind = new Map<string, number>();
  const perSource = new Map<string, number>();

  for (const candidate of candidates.slice().sort((a, b) => b.score - a.score)) {
    if (selected.length >= options.maxCases) break;
    const categoryCount = perCategory.get(candidate.caseCategory) || 0;
    const kindCount = perKind.get(candidate.kind) || 0;
    const sourceCount = perSource.get(candidate.sourcePath) || 0;
    if (categoryCount >= 8 || kindCount >= 4 || sourceCount >= 3) continue;
    selected.push(candidate);
    perCategory.set(candidate.caseCategory, categoryCount + 1);
    perKind.set(candidate.kind, kindCount + 1);
    perSource.set(candidate.sourcePath, sourceCount + 1);
  }

  if (selected.length < options.maxCases) {
    for (const candidate of candidates.slice().sort((a, b) => b.score - a.score)) {
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

function kindForEpisode(episode: LegacyTraceEpisode): string {
  const issueTypes = episode.failureModesObserved;
  if (issueTypes.includes('credential_exposure')) return 'log_hygiene_redaction';
  if (issueTypes.includes('restore_event') || episode.taskType === 'runtime_restore') return 'runtime_restore';
  if (issueTypes.includes('context_pressure') || episode.taskType === 'context_compaction') return 'context_pressure';
  if (issueTypes.includes('platform_command_mismatch')) return 'platform_command_mismatch';
  if (issueTypes.includes('api_or_network_failure')) return 'network_failure_recovery';
  if (issueTypes.includes('rate_limited_retry')) return 'rate_limit_recovery';
  if (issueTypes.includes('slow_tool') || issueTypes.includes('very_slow_tool')) return 'slow_tool_observability';
  if (episode.taskType !== 'tool_task' && episode.taskType !== 'dialog_task') return episode.taskType;
  if (episode.toolCallCount >= 5) return 'multi_tool_task';
  if (episode.promptTokens >= 40000) return 'large_context_task';
  if (episode.toolCallCount > 0) return 'tool_task';
  return 'dialog_task';
}

function scoreEpisodeCase(episode: LegacyTraceEpisode): number {
  return Math.round(
    episode.turnCount * 8
    + episode.toolCallCount * 5
    + episode.failureModesObserved.length * 14
    + Math.min(25, episode.promptTokens / 4000)
    + Math.min(20, episode.maxToolDurationMs / 3000)
    + (episode.requiresArtifact ? 12 : 0)
    + (episode.requiresLongContext ? 18 : 0)
    + (episode.skillsTriggered.length > 0 ? 12 : 0)
    + (episode.runtimeEventCount > 0 ? 4 : 0),
  );
}

function classifyEpisodeCaseCategory(episode: LegacyTraceEpisode): LegacyTraceCaseCategory {
  const runtimeSignals = new Set([
    'credential_exposure',
    'context_pressure',
    'platform_command_mismatch',
    'api_or_network_failure',
    'rate_limited_retry',
    'slow_tool',
    'very_slow_tool',
    'restore_event',
    'runtime_error',
    'runtime_warning',
    'compaction_event',
    'outside_read_blocked',
    'timeout',
  ]);
  const skillTaskTypes = new Set([
    'workflow_packaging',
    'plot_generation',
    'cluster_annotation',
    'marker_analysis',
    'r_script_editing',
    'seurat_object_inspection',
    'report_generation',
  ]);
  const hasRuntimeSignal = episode.failureModesObserved.some(issue => runtimeSignals.has(issue))
    || episode.taskType === 'runtime_restore'
    || episode.taskType === 'context_compaction'
    || episode.taskType === 'artifact_delivery';
  const hasSkillSignal = episode.skillsTriggered.length > 0 || skillTaskTypes.has(episode.taskType);

  if (hasRuntimeSignal && hasSkillSignal) return 'hybrid_case';
  if (hasSkillSignal) return 'skill_case';
  return 'runtime_case';
}

function expectationsForCase(kind: string, issueTypes: string[], episode: LegacyTraceEpisode): string[] {
  const expectations = [
    'legacy JSONL can be normalized without losing turn, token, and tool-call counts',
    'episode-level metadata preserves turn, tool-call, success, failure, skill, artifact, and routing fields',
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
  if (episode.requiresArtifact) {
    expectations.push('artifact cases must expose enough evidence for a file-exists or content verifier');
  }
  if (episode.skillsTriggered.length > 0) {
    expectations.push('skill-triggered cases record the activated skill name for skill-level regression routing');
  }
  if (kind === 'browser_recovery') {
    expectations.push('browser fallback path is explicit when the preferred browser harness is unavailable');
  }

  return unique(expectations);
}

function compareTurns(a: NormalizedTurn, b: NormalizedTurn): number {
  if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath);
  if (a.sessionHash !== b.sessionHash) return a.sessionHash.localeCompare(b.sessionHash);
  if (a.interactionId !== b.interactionId) return a.interactionId - b.interactionId;
  const timeDiff = parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp);
  if (timeDiff !== 0) return timeDiff;
  return a.turn - b.turn;
}

function compareRuntimeEvents(a: RuntimeEvent, b: RuntimeEvent): number {
  if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath);
  if (a.sessionHash !== b.sessionHash) return a.sessionHash.localeCompare(b.sessionHash);
  return parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp);
}

function compareEpisodeDrafts(a: LegacyTraceEpisodeDraft, b: LegacyTraceEpisodeDraft): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.sourcePaths[0] !== b.sourcePaths[0]) return (a.sourcePaths[0] || '').localeCompare(b.sourcePaths[0] || '');
  const timeDiff = parseTimestampMs(a.startTimestamp) - parseTimestampMs(b.startTimestamp);
  if (timeDiff !== 0) return timeDiff;
  return a.startTurn - b.startTurn;
}

function shouldStartNewEpisode(previous: NormalizedTurn, next: NormalizedTurn, current: NormalizedTurn[]): boolean {
  const previousTime = parseTimestampMs(previous.timestamp);
  const nextTime = parseTimestampMs(next.timestamp);
  if (previousTime > 0 && nextTime > 0 && nextTime - previousTime > EPISODE_GAP_MS) {
    return true;
  }
  if (previous.tools.some(tool => tool.name === 'send_file')) {
    return true;
  }
  if (isExplicitEpisodeBoundary(next.userText)) {
    return true;
  }

  const previousTask = classifyEpisodeTask(turnSignalText(previous), previous.issues.map(issue => issue.type), previous.tools.map(tool => tool.name), []);
  const nextTask = classifyEpisodeTask(turnSignalText(next), next.issues.map(issue => issue.type), next.tools.map(tool => tool.name), []);
  if (current.length >= 2 && isSpecificTask(previousTask) && isSpecificTask(nextTask) && previousTask !== nextTask) {
    return true;
  }

  return false;
}

function isExplicitEpisodeBoundary(text: string): boolean {
  return /(进入另一个|另一个路径|换.*路径|重新|现在请|接下来|另外|打包成|打包为|沉淀成|复用成|新的任务|新任务)/i.test(text);
}

function isSpecificTask(taskType: string): boolean {
  return !['tool_task', 'dialog_task', 'remote_workspace_navigation', 'artifact_delivery'].includes(taskType);
}

function turnGroupKey(turn: NormalizedTurn): string {
  return `${turn.sourcePath}\0${turn.sessionHash}\0${turn.interactionId}`;
}

function runtimeGroupKey(event: RuntimeEvent): string {
  return `${event.sourcePath}\0${event.sessionHash}`;
}

function runtimeGroupKeyFromTurn(turn: NormalizedTurn): string {
  return `${turn.sourcePath}\0${turn.sessionHash}`;
}

function selectRuntimeEventsForTurns(events: RuntimeEvent[], turns: NormalizedTurn[]): RuntimeEvent[] {
  if (events.length === 0 || turns.length === 0) return [];
  const start = parseTimestampMs(turns[0].timestamp);
  const end = parseTimestampMs(turns[turns.length - 1].timestamp);
  if (start <= 0 || end <= 0) return [];
  return events.filter(event => {
    const time = parseTimestampMs(event.timestamp);
    if (time <= 0) return false;
    return time >= start - EPISODE_GAP_MS && time <= end + EPISODE_GAP_MS;
  });
}

function splitRuntimeEvents(events: RuntimeEvent[]): RuntimeEvent[][] {
  const chunks: RuntimeEvent[][] = [];
  let current: RuntimeEvent[] = [];
  for (const event of events) {
    const previous = current[current.length - 1];
    if (previous) {
      const gap = parseTimestampMs(event.timestamp) - parseTimestampMs(previous.timestamp);
      if (gap > EPISODE_GAP_MS) {
        chunks.push(current);
        current = [];
      }
    }
    current.push(event);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function turnSignalText(turn: NormalizedTurn): string {
  return [
    turn.userText,
    turn.assistantText,
    ...turn.tools.flatMap(tool => [tool.argumentsText, tool.resultText]),
  ].join('\n');
}

function classifyEpisodeTask(
  text: string,
  issueTypes: string[],
  toolsUsed: string[],
  artifactsObserved: string[],
): string {
  const toolText = toolsUsed.join(' ');
  const combined = `${text}\n${toolText}`;
  if (/打包.*skill|skill.*打包|沉淀.*skill|复用.*skill|workflow packaging/i.test(combined)) {
    return 'workflow_packaging';
  }
  if (/FeaturePlot|DotPlot|DimPlot|VlnPlot|pheatmap|heatmap|ggplot|ggsave|png|pdf|画图|出图|绘图|热图/i.test(combined)) {
    return 'plot_generation';
  }
  if (/cluster|marker|findmarkers|cell\s*type|celltype|细胞类型|注释|亚群|marker表/i.test(combined)) {
    return 'cluster_annotation';
  }
  if (/\.R\b|Rscript|source\(|脚本|edit_file|write_file|annot\.R|score\.R|修改代码|改代码/i.test(combined)) {
    return 'r_script_editing';
  }
  if (/Seurat|\.rds\b|\.RDS\b|merge\.Rds|meta\.data|metadata|单细胞|single[- ]cell/i.test(combined)) {
    return 'seurat_object_inspection';
  }
  if (/报告|report|html|markdown|总结/i.test(combined)) {
    return 'report_generation';
  }
  if (toolsUsed.includes('send_file') || artifactsObserved.length > 0) {
    return 'artifact_delivery';
  }
  if (/ssh|服务器|远程|进入路径|工作目录|\/share\/home|\/home\/|pwd|ls -|cd /i.test(combined)) {
    return 'remote_workspace_navigation';
  }
  if (issueTypes.includes('context_pressure') || issueTypes.includes('compaction_event')) {
    return 'long_context_recovery';
  }
  if (issueTypes.some(issue => ['tool_failure', 'api_or_network_failure', 'timeout', 'rate_limited_retry'].includes(issue))) {
    return 'failure_recovery';
  }
  if (toolsUsed.length > 0) return 'tool_task';
  return 'dialog_task';
}

function extractSkillsFromTool(tool: NormalizedToolCall): string[] {
  const skills: string[] = [];
  if (tool.skillId) {
    skills.push(tool.skillId);
  }
  const payload = parseLooseJson(tool.argumentsText);
  for (const key of ['skill', 'skillName', 'skill_name', 'name', 'id']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) skills.push(value.trim());
  }

  const combined = `${tool.argumentsText}\n${tool.resultText}`;
  const patterns = [
    /Skill\s+["']([^"']+)["']\s*(?:已激活|activated)/gi,
    /(?:技能|skill)\s*[:：]\s*([A-Za-z0-9_.-]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of combined.matchAll(pattern)) {
      if (match[1]) skills.push(match[1].trim());
    }
  }

  if (tool.name === 'skill' && skills.length === 0) {
    skills.push('unknown_skill');
  }

  return unique(skills.map(skill => redactSensitiveText(skill)).filter(Boolean));
}

function parseLooseJson(text: string): Record<string, any> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeArtifactManifest(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return unique(raw
    .map(item => redactSensitiveText(safeString(item?.path ?? item?.file_path ?? item?.name)))
    .map(value => value.replace(/\\/g, '/').replace(/[),.;:]+$/g, ''))
    .filter(Boolean));
}

function issueFromErrorCode(errorCode: string): LegacyTraceIssue | undefined {
  const normalized = errorCode.trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized === 'TOOL_TIMEOUT') return { type: 'timeout', severity: 'high' };
  if (normalized === 'RATE_LIMIT') return { type: 'rate_limited_retry', severity: 'medium' };
  if (normalized === 'PATH_DENIED') return { type: 'outside_read_blocked', severity: 'medium' };
  if (normalized === 'PLATFORM_COMMAND_MISMATCH') return { type: 'platform_command_mismatch', severity: 'medium' };
  if (normalized === 'PROVIDER_ERROR') return { type: 'api_or_network_failure', severity: 'high' };
  return { type: `error_code:${normalized.toLowerCase()}`, severity: 'medium' };
}

function extractArtifactsFromText(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:\\[^\s"'`]+|\/[^\s"'`]+|[\w.-]+\/[^\s"'`]+|[\w.-]+\.(?:png|pdf|r|R|csv|tsv|xlsx|html|zip|rds|Rds|RDS))/g) || [];
  const artifacts = matches
    .filter(value => /\.(?:png|pdf|r|R|csv|tsv|xlsx|html|zip|rds|Rds|RDS)(?:$|[?#])/i.test(value))
    .map(value => redactSensitiveText(value.replace(/\\/g, '/')).replace(/[),.;:]+$/g, ''))
    .map(value => truncatePlain(value, 160))
    .filter(value => value.length > 0);
  return unique(artifacts).slice(0, 20);
}

function summarizeEpisodeTask(turns: NormalizedTurn[]): string {
  const firstWithUserText = turns.find(turn => turn.userText.trim()) || turns[0];
  const raw = firstWithUserText?.userText || firstWithUserText?.assistantText || 'legacy trace episode';
  return redactSensitiveText(truncatePlain(raw, 180));
}

function summarizeRuntimeEpisode(runtimeEvents: RuntimeEvent[]): string {
  const first = runtimeEvents.find(event => event.message.trim()) || runtimeEvents[0];
  return redactSensitiveText(truncatePlain(first?.message || 'runtime signal episode', 180));
}

function summarizeRuntimeTools(runtimeEvents: RuntimeEvent[]): {
  toolNames: string[];
  toolCallCount: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  maxToolDurationMs: number;
} {
  let toolCallCount = 0;
  let failedToolCalls = 0;
  let maxToolDurationMs = 0;
  const toolNames: string[] = [];

  for (const event of runtimeEvents) {
    const tool = normalizeRuntimeToolEvent(event.message);
    if (!tool) continue;
    addUnique(toolNames, tool.name);
    if (tool.countsAsCall) {
      toolCallCount++;
    }
    if (tool.success === false) {
      failedToolCalls++;
    }
    if (tool.durationMs !== undefined) {
      maxToolDurationMs = Math.max(maxToolDurationMs, tool.durationMs);
    }
  }

  return {
    toolNames: toolNames.sort(),
    toolCallCount,
    successfulToolCalls: Math.max(0, toolCallCount - failedToolCalls),
    failedToolCalls,
    maxToolDurationMs,
  };
}

function summarizeRuntimeTokens(runtimeEvents: RuntimeEvent[]): { promptTokens: number; completionTokens: number } {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const event of runtimeEvents) {
    const tokens = parseRuntimeTokens(event.message);
    if (!tokens) continue;
    promptTokens += tokens.prompt;
    completionTokens += tokens.completion;
  }
  return { promptTokens, completionTokens };
}

function needsRemoteFixture(text: string, toolsUsed: string[], domain: string): boolean {
  if (/ssh|服务器|远程|\/share\/home|\/home\/|conda|sbatch|Rscript/i.test(text)) return true;
  return domain !== 'general' && toolsUsed.includes('execute_shell');
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function maxValue(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

function countValues(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    increment(counts, value);
  }
  return toSortedRecord(counts);
}

function slugifyBenchmarkName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'legacy-trace';
}

function parseTimestampMs(timestamp: string): number {
  if (!timestamp) return 0;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : 0;
}

export function redactSensitiveText(input: string): string {
  let output = input;
  output = output.replace(/("?(?:password|passwd|passphrase|api[_-]?key|secret|token|authorization)"?\s*[:=]\s*)"[^"\n\r]*"/gi, '$1"[REDACTED]"');
  output = output.replace(/("?(?:password|passwd|passphrase|api[_-]?key|secret|token|authorization)"?\s*[:=]\s*)'[^'\n\r]*'/gi, "$1'[REDACTED]'");
  output = output.replace(/((?:密码|口令|password|passwd|passphrase)\s*(?:为|是|:|：|=)\s*)[^\s，。,.!！?？"'`]+/gi, '$1[REDACTED]');
  output = output.replace(/((?:账号|帐号|用户名|username|user)\s*(?:为|是|:|：|=)\s*)[^\s，。,.!！?？"'`]+/gi, '$1[USER]');
  output = output.replace(/(\bsshpass(?:\.exe)?\b[\s\S]{0,120}?\s-p\s+)'[^'\n\r]+'/gi, "$1'[REDACTED]'");
  output = output.replace(/(\bsshpass(?:\.exe)?\b[\s\S]{0,120}?\s-p\s+)"[^"\n\r]+"/gi, '$1"[REDACTED]"');
  output = output.replace(/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}\b/g, '[PRIVATE_IP]');
  output = output.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\\\s"']+/g, '$1[USER]');
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
    /(?:密码|口令|password|passwd|passphrase)\s*(?:为|是|:|：|=)\s*[^\s，。,.!！?？"'`]+/gi,
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
