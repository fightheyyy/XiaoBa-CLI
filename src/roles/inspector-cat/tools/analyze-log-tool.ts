import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';

interface ToolCallRecord {
  name: string;
  duration?: number;
  success?: boolean;
  params?: string;
  result?: string;
}

interface TurnData {
  turn: number;
  sessionId?: string;
  interactionId?: number;
  turnKey?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  aiDuration?: number;
  userMessage: string;
  aiResponse: string;
  tools: ToolCallRecord[];
  issueTypes?: string[];
}

interface IssueData {
  type: string;
  severity: 'high' | 'medium' | 'low';
  turn: number;
  sessionId?: string;
  interactionId?: number;
  turnKey?: string;
  description: string;
  context?: string;
}

interface AnalysisResult {
  summary: {
    totalTurns: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    totalDuration: number;
    startTime: string;
    endTime: string;
    sessionCount?: number;
    interactionCount?: number;
    issueCount?: number;
    issueCounts?: Record<string, number>;
    returnedTurns?: number;
    truncatedTurns?: boolean;
  };
  toolStats: { name: string; count: number; successes: number; failures: number; avgDuration: number }[];
  issues: IssueData[];
  turns?: TurnData[];
}

type ParsedJsonlEntry = Record<string, any>;

const MAX_CONTENT_LENGTH = 200;
const MAX_ISSUE_CONTEXT_LENGTH = 500;
const MAX_DEEP_TURNS = 120;
const MAX_ISSUE_EVIDENCE_PER_TYPE = 8;

function truncate(str: string, max: number = MAX_CONTENT_LENGTH): string {
  if (!str) return '';
  const cleaned = str.replace(/\n/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 3) + '...';
}

export class AnalyzeLogTool implements Tool {
  definition: ToolDefinition = {
    name: 'analyze_log',
    description: '分析 XiaoBa 日志文件（支持 JSONL 对话日志和文本运行日志），提取会话统计、工具调用、问题模式和对话摘要',
    parameters: {
      type: 'object',
      properties: {
        log_source: {
          type: 'string',
          description: '日志文件路径（.jsonl 或 .log）'
        },
        analysis_depth: {
          type: 'string',
          enum: ['quick', 'deep'],
          description: '分析深度：quick 只返回概览，deep 返回完整的轮次对话摘要'
        }
      },
      required: ['log_source']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const { log_source, analysis_depth = 'quick' } = args;

    try {
      const absolutePath = path.isAbsolute(log_source)
        ? log_source
        : path.join(context.workingDirectory, log_source);

      if (!fs.existsSync(absolutePath)) {
        return `错误：日志文件不存在: ${absolutePath}`;
      }

      const stats = fs.statSync(absolutePath);
      if (stats.isDirectory()) {
        return '错误：暂不支持目录分析，请指定单个日志文件';
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');
      const isJSONL = absolutePath.endsWith('.jsonl') || this.looksLikeJSONL(content);

      const result = isJSONL
        ? this.parseJSONL(content, analysis_depth)
        : this.parseTextLog(content, analysis_depth);

      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return `分析日志失败: ${error.message}`;
    }
  }

  private looksLikeJSONL(content: string): boolean {
    const firstLine = content.split('\n')[0]?.trim();
    if (!firstLine) return false;
    try {
      const obj = JSON.parse(firstLine);
      return !!obj && typeof obj === 'object';
    } catch {
      return false;
    }
  }

  private parseJSONL(content: string, depth: string): AnalysisResult {
    const lines = content.trim().split('\n').filter(l => l.trim());
    const parsedEntries = lines
      .map(line => {
        try {
          return JSON.parse(line) as ParsedJsonlEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ParsedJsonlEntry => !!entry && typeof entry === 'object');

    if (parsedEntries.length === 0) {
      return {
        summary: {
          totalTurns: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          toolCalls: 0,
          totalDuration: 0,
          startTime: '',
          endTime: '',
          sessionCount: 0,
          interactionCount: 0,
          issueCount: 0,
          issueCounts: {},
          returnedTurns: depth === 'deep' ? 0 : undefined,
          truncatedTurns: false,
        },
        toolStats: [],
        issues: [],
        ...(depth === 'deep' ? { turns: [] } : {}),
      };
    }

    const turnEntries = parsedEntries.filter(entry => this.isTurnEntry(entry));
    if (turnEntries.length === 0) {
      return this.parseRuntimeJSONL(parsedEntries, depth);
    }

    const turns: TurnData[] = [];
    const toolAgg: Map<string, { count: number; successes: number; failures: number; totalDuration: number }> = new Map();
    const issues: IssueData[] = [];
    const issueCounts: Map<string, number> = new Map();
    const turnIssueTypes: Map<string, Set<string>> = new Map();
    const sessionStates: Map<string, { interactionId: number; lastObservedTurn: number }> = new Map();

    let totalInput = 0;
    let totalOutput = 0;
    let startTime = '';
    let endTime = '';

    const addIssue = (issue: IssueData) => {
      const nextCount = (issueCounts.get(issue.type) || 0) + 1;
      issueCounts.set(issue.type, nextCount);

      if (issue.turnKey) {
        if (!turnIssueTypes.has(issue.turnKey)) {
          turnIssueTypes.set(issue.turnKey, new Set());
        }
        turnIssueTypes.get(issue.turnKey)!.add(issue.type);
      }

      if (nextCount <= MAX_ISSUE_EVIDENCE_PER_TYPE) {
        issues.push(issue);
      }
    };

    for (const entry of turnEntries) {
        const turn = Number(entry.turn) || 0;
        const timestamp = entry.timestamp;
        const sessionId = String(entry.session_id || 'unknown');
        const state = sessionStates.get(sessionId) || { interactionId: 1, lastObservedTurn: 0 };

        if (state.lastObservedTurn > 0 && turn > 0 && turn <= state.lastObservedTurn) {
          state.interactionId += 1;
          state.lastObservedTurn = 0;
        }

        state.lastObservedTurn = turn > 0 ? turn : state.lastObservedTurn;
        sessionStates.set(sessionId, state);

        const interactionId = state.interactionId;
        const turnKey = `${sessionId}#${interactionId}#${turn || interactionId}`;

        if (!startTime) startTime = timestamp;
        endTime = timestamp;

        const userMsg = truncate(entry.user?.text || '');
        const aiMsg = truncate(entry.assistant?.text || '');
        const toolCalls: ToolCallRecord[] = [];
        const fullAiText = String(entry.assistant?.text || '');

        if (/\bkill\b/i.test(userMsg) && !/\bskill\b/i.test(userMsg)) {
          addIssue({
            type: 'user_kill',
            severity: 'high',
            turn,
            sessionId,
            interactionId,
            turnKey,
            description: truncate(userMsg, 300),
          });
        }

        if (!aiMsg || /\(empty\)/i.test(aiMsg)) {
          addIssue({
            type: 'empty_reply',
            severity: 'medium',
            turn,
            sessionId,
            interactionId,
            turnKey,
            description: `Turn ${turn || interactionId}: AI 回复为空`,
          });
        }

        if (/API调用失败|Connection error|\bENOTFOUND\b|认证失败|getaddrinfo/i.test(fullAiText)) {
          addIssue({
            type: 'api_or_network_failure',
            severity: /\bENOTFOUND\b|Connection error|getaddrinfo/i.test(fullAiText) ? 'high' : 'medium',
            turn,
            sessionId,
            interactionId,
            turnKey,
            description: truncate(fullAiText, 300),
          });
        }

        if (entry.assistant?.tool_calls && Array.isArray(entry.assistant.tool_calls)) {
          for (const tc of entry.assistant.tool_calls) {
            const toolName = tc.name;
            const resultText = typeof tc.result === 'string'
              ? tc.result
              : JSON.stringify(tc.result ?? '');
            const paramsText = typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments ?? {});
            const duration = typeof tc.duration_ms === 'number' ? tc.duration_ms : undefined;
            const success = !/(失败|错误|error|fail|执行被阻止|denied|blocked)/i.test(resultText);

            toolCalls.push({
              name: toolName,
              params: paramsText ? truncate(paramsText, 150) : undefined,
              result: resultText ? truncate(resultText, 150) : undefined,
              success,
              duration,
            });

            if (!toolAgg.has(toolName)) {
              toolAgg.set(toolName, { count: 0, successes: 0, failures: 0, totalDuration: 0 });
            }
            const agg = toolAgg.get(toolName)!;
            agg.count++;
            if (success) agg.successes++;
            else agg.failures++;
            if (duration) {
              agg.totalDuration += duration;
            }

            if (!success) {
              addIssue({
                type: 'tool_failure',
                severity: 'medium',
                turn,
                sessionId,
                interactionId,
                turnKey,
                description: truncate(`工具 ${toolName} 执行失败: ${resultText}`, 300),
              });
            }

            if (duration !== undefined && duration >= 10000) {
              addIssue({
                type: 'slow_tool',
                severity: duration >= 30000 ? 'high' : 'medium',
                turn,
                sessionId,
                interactionId,
                turnKey,
                description: `工具 ${toolName} 耗时 ${duration}ms，存在明显卡顿`,
              });
            }

            if (/timeout|超时/i.test(resultText)) {
              addIssue({
                type: 'timeout',
                severity: 'high',
                turn,
                sessionId,
                interactionId,
                turnKey,
                description: truncate(`工具 ${toolName} 超时: ${resultText}`, 300),
                context: truncate(resultText, MAX_ISSUE_CONTEXT_LENGTH),
              });
            }

            if (/429/.test(resultText) && /限流|重试|rate limit|too many requests/i.test(resultText)) {
              addIssue({
                type: 'rate_limited_retry',
                severity: 'medium',
                turn,
                sessionId,
                interactionId,
                turnKey,
                description: truncate(`工具 ${toolName} 命中限流: ${resultText}`, 300),
              });
            }

            if (/执行被阻止: 读取路径超出工作目录/.test(resultText)) {
              addIssue({
                type: 'outside_read_blocked',
                severity: 'medium',
                turn,
                sessionId,
                interactionId,
                turnKey,
                description: '尝试读取工作目录外文件，但被路径策略拦截',
              });
            }

            if (/不是内部或外部命令/.test(resultText) && /\b(head|tail|find|grep|ls)\b/i.test(paramsText + ' ' + resultText)) {
              addIssue({
                type: 'platform_command_mismatch',
                severity: 'medium',
                turn,
                sessionId,
                interactionId,
                turnKey,
                description: truncate(`工具 ${toolName} 存在平台命令不兼容: ${resultText}`, 300),
              });
            }

            if (/API调用失败|Connection error|\bENOTFOUND\b|认证失败|getaddrinfo/i.test(resultText)) {
              addIssue({
                type: 'api_or_network_failure',
                severity: /\bENOTFOUND\b|Connection error|getaddrinfo/i.test(resultText) ? 'high' : 'medium',
                turn,
                sessionId,
                interactionId,
                turnKey,
                description: truncate(resultText, 300),
              });
            }
          }
        }

        const inputTokens = entry.tokens?.prompt || 0;
        const outputTokens = entry.tokens?.completion || 0;
        totalInput += inputTokens;
        totalOutput += outputTokens;

        turns.push({
          turn,
          sessionId,
          interactionId,
          turnKey,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          userMessage: userMsg,
          aiResponse: aiMsg,
          tools: toolCalls
        });

        if (aiMsg.includes('错误') || aiMsg.includes('失败')) {
          addIssue({
            type: 'error',
            severity: 'medium',
            turn,
            sessionId,
            interactionId,
            turnKey,
            description: `Turn ${turn}: AI 回复包含错误信息`,
            context: truncate(aiMsg, 300)
          });
        }
    }

    for (const [name, agg] of toolAgg) {
      if (agg.failures >= 3) {
        addIssue({
          type: 'repeated_tool_failures',
          severity: agg.failures >= 5 ? 'high' : 'medium',
          turn: 0,
          description: `工具 ${name} 失败 ${agg.failures} 次，存在稳定性问题`
        });
      }
      if (agg.count >= 3 && agg.totalDuration > 0 && agg.totalDuration / agg.count >= 5000) {
        addIssue({
          type: 'slow_tool_pattern',
          severity: 'medium',
          turn: 0,
          description: `工具 ${name} 平均耗时 ${Math.round(agg.totalDuration / agg.count)}ms，整体偏慢`
        });
      }
    }

    const toolStats = Array.from(toolAgg.entries())
      .map(([name, agg]) => ({
        name,
        count: agg.count,
        successes: agg.successes,
        failures: agg.failures,
        avgDuration: agg.count > 0 && agg.totalDuration > 0 ? Math.round(agg.totalDuration / agg.count) : 0
      }))
      .sort((a, b) => {
        if (b.failures !== a.failures) return b.failures - a.failures;
        return b.count - a.count;
      });

    const turnsArray = turns
      .sort((a, b) => {
        if ((a.sessionId || '') !== (b.sessionId || '')) {
          return (a.sessionId || '').localeCompare(b.sessionId || '');
        }
        if ((a.interactionId || 0) !== (b.interactionId || 0)) {
          return (a.interactionId || 0) - (b.interactionId || 0);
        }
        return a.turn - b.turn;
      })
      .map(turn => ({
        ...turn,
        issueTypes: turn.turnKey ? Array.from(turnIssueTypes.get(turn.turnKey) || []) : []
      }));

    const deepTurns = this.selectTurnsForDeep(turnsArray);
    const issueCountsObject = Object.fromEntries([...issueCounts.entries()].sort((a, b) => b[1] - a[1]));
    const interactionCount = [...sessionStates.values()].reduce((sum, state) => sum + state.interactionId, 0);

    const summary = {
      totalTurns: turns.length,
      totalTokens: totalInput + totalOutput,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      toolCalls: toolStats.reduce((s, t) => s + t.count, 0),
      totalDuration: 0,
      startTime,
      endTime,
      sessionCount: sessionStates.size,
      interactionCount,
      issueCount: [...issueCounts.values()].reduce((sum, count) => sum + count, 0),
      issueCounts: issueCountsObject,
      returnedTurns: depth === 'deep' ? deepTurns.length : undefined,
      truncatedTurns: depth === 'deep' ? deepTurns.length < turnsArray.length : undefined
    };

    const sortedIssues = issues.sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      if (severityRank[b.severity] !== severityRank[a.severity]) {
        return severityRank[b.severity] - severityRank[a.severity];
      }
      if ((a.sessionId || '') !== (b.sessionId || '')) {
        return (a.sessionId || '').localeCompare(b.sessionId || '');
      }
      if ((a.interactionId || 0) !== (b.interactionId || 0)) {
        return (a.interactionId || 0) - (b.interactionId || 0);
      }
      return a.turn - b.turn;
    });

    return {
      summary,
      toolStats,
      issues: sortedIssues,
      ...(depth === 'deep' ? { turns: deepTurns } : {})
    };
  }

  private isTurnEntry(entry: ParsedJsonlEntry): boolean {
    if (entry.entry_type === 'turn') {
      return true;
    }

    return ('turn' in entry && ('user' in entry || 'assistant' in entry))
      || ('assistant' in entry && 'tokens' in entry);
  }

  private isRuntimeEntry(entry: ParsedJsonlEntry): boolean {
    if (entry.entry_type === 'runtime') {
      return true;
    }

    return ('level' in entry && 'message' in entry)
      || ('message' in entry && 'session_id' in entry && !this.isTurnEntry(entry));
  }

  private parseRuntimeJSONL(entries: ParsedJsonlEntry[], depth: string): AnalysisResult {
    const runtimeEntries = entries.filter(entry => this.isRuntimeEntry(entry));
    const toolAgg: Map<string, { count: number; successes: number; failures: number; totalDuration: number }> = new Map();
    const issues: IssueData[] = [];
    const issueCounts: Map<string, number> = new Map();
    const sessionIds = new Set<string>();
    let startTime = '';
    let endTime = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const addIssue = (issue: IssueData) => {
      const nextCount = (issueCounts.get(issue.type) || 0) + 1;
      issueCounts.set(issue.type, nextCount);
      if (nextCount <= MAX_ISSUE_EVIDENCE_PER_TYPE) {
        issues.push(issue);
      }
    };

    for (const entry of runtimeEntries) {
      const timestamp = String(entry.timestamp || '');
      const sessionId = typeof entry.session_id === 'string' ? entry.session_id : undefined;
      const level = String(entry.level || '').toUpperCase();
      const message = String(entry.message || entry.text || '');

      if (timestamp) {
        if (!startTime) startTime = timestamp;
        endTime = timestamp;
      }
      if (sessionId) {
        sessionIds.add(sessionId);
      }

      inputTokens += Number(entry.tokens?.prompt || entry.input_tokens || 0);
      outputTokens += Number(entry.tokens?.completion || entry.output_tokens || 0);

      const toolExecMatch = message.match(/执行工具:\s*(\S+)/);
      if (toolExecMatch) {
        const toolName = toolExecMatch[1];
        if (!toolAgg.has(toolName)) {
          toolAgg.set(toolName, { count: 0, successes: 0, failures: 0, totalDuration: 0 });
        }
        toolAgg.get(toolName)!.count += 1;
      }

      const toolDoneMatch = message.match(/工具完成:\s*(\S+)\s*\|\s*耗时:\s*(\d+)ms\s*\|\s*结果:\s*(.+)$/);
      if (toolDoneMatch) {
        const toolName = toolDoneMatch[1];
        const duration = parseInt(toolDoneMatch[2], 10);
        const resultText = toolDoneMatch[3];
        const success = !/(失败|错误|error|fail|执行被阻止|denied|blocked)/i.test(resultText);
        if (!toolAgg.has(toolName)) {
          toolAgg.set(toolName, { count: 0, successes: 0, failures: 0, totalDuration: 0 });
        }
        const agg = toolAgg.get(toolName)!;
        agg.totalDuration += duration;
        if (success) agg.successes += 1;
        else agg.failures += 1;
      }

      if (level === 'ERROR' || /\b(error|失败|异常)\b/i.test(message)) {
        addIssue({
          type: 'runtime_error',
          severity: 'high',
          turn: 0,
          sessionId,
          description: truncate(message, 300),
        });
      } else if (level === 'WARN' || /\b(timeout|超时|429|限流)\b/i.test(message)) {
        addIssue({
          type: 'runtime_warning',
          severity: /429|限流|timeout|超时/i.test(message) ? 'high' : 'medium',
          turn: 0,
          sessionId,
          description: truncate(message, 300),
        });
      }

      if (/send_to_inspector/i.test(message) && /未找到工具|TOOL_NOT_FOUND|不存在/i.test(message)) {
        addIssue({
          type: 'ghost_tool_registration',
          severity: 'medium',
          turn: 0,
          sessionId,
          description: truncate(message, 300),
        });
      }
    }

    for (const [name, agg] of toolAgg) {
      if (agg.failures >= 2) {
        addIssue({
          type: 'repeated_tool_failures',
          severity: agg.failures >= 4 ? 'high' : 'medium',
          turn: 0,
          description: `工具 ${name} 在 runtime 日志里失败 ${agg.failures} 次`,
        });
      }
    }

    const toolStats = Array.from(toolAgg.entries()).map(([name, agg]) => ({
      name,
      count: agg.count,
      successes: agg.successes,
      failures: agg.failures,
      avgDuration: agg.count > 0 && agg.totalDuration > 0 ? Math.round(agg.totalDuration / agg.count) : 0,
    }))
      .sort((a, b) => {
        if (b.failures !== a.failures) return b.failures - a.failures;
        return b.count - a.count;
      });

    const issueCountsObject = Object.fromEntries([...issueCounts.entries()].sort((a, b) => b[1] - a[1]));
    const sortedIssues = issues.sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      return severityRank[b.severity] - severityRank[a.severity];
    });

    return {
      summary: {
        totalTurns: 0,
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        toolCalls: toolStats.reduce((sum, item) => sum + item.count, 0),
        totalDuration: 0,
        startTime,
        endTime,
        sessionCount: sessionIds.size,
        interactionCount: 0,
        issueCount: [...issueCounts.values()].reduce((sum, count) => sum + count, 0),
        issueCounts: issueCountsObject,
        returnedTurns: depth === 'deep' ? 0 : undefined,
        truncatedTurns: false,
      },
      toolStats,
      issues: sortedIssues,
      ...(depth === 'deep' ? { turns: [] } : {}),
    };
  }

  private selectTurnsForDeep(allTurns: TurnData[]): TurnData[] {
    if (allTurns.length <= MAX_DEEP_TURNS) {
      return allTurns;
    }

    const selectedKeys = new Set<string>();
    const addTurn = (turn: TurnData) => {
      if (turn.turnKey) selectedKeys.add(turn.turnKey);
    };

    allTurns.slice(0, 20).forEach(addTurn);
    allTurns.slice(-20).forEach(addTurn);
    allTurns.filter(turn => (turn.issueTypes?.length || 0) > 0).forEach(addTurn);
    [...allTurns]
      .sort((a, b) => {
        const aScore = a.totalTokens + a.tools.length * 100 + ((a.issueTypes?.length || 0) * 1000);
        const bScore = b.totalTokens + b.tools.length * 100 + ((b.issueTypes?.length || 0) * 1000);
        return bScore - aScore;
      })
      .slice(0, 20)
      .forEach(addTurn);

    const selected = allTurns.filter(turn => turn.turnKey && selectedKeys.has(turn.turnKey));
    if (selected.length >= MAX_DEEP_TURNS) {
      return selected.slice(0, MAX_DEEP_TURNS);
    }

    const remaining = allTurns.filter(turn => !turn.turnKey || !selectedKeys.has(turn.turnKey));
    return [...selected, ...remaining.slice(0, MAX_DEEP_TURNS - selected.length)];
  }

  private parseTextLog(content: string, depth: string): AnalysisResult {
    interface SessionState {
      sessionId: string;
      interactionId: number;
      currentUserMessage: string;
      lastObservedTurn: number;
    }

    const lines = content.split(/\r?\n/);
    const turns: Map<string, TurnData> = new Map();
    const toolAgg: Map<string, { count: number; successes: number; failures: number; totalDuration: number }> = new Map();
    const issues: IssueData[] = [];
    const issueCounts: Map<string, number> = new Map();
    const turnIssueTypes: Map<string, Set<string>> = new Map();
    const sessionStates: Map<string, SessionState> = new Map();
    const aiStartTimes: Map<string, number> = new Map();

    let metricsInput = 0;
    let metricsOutput = 0;
    let metricsToolCalls = 0;
    let startTime = '';
    let endTime = '';
    let lastSessionId = 'global';

    const turnContextRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]\s+上下文:/;
    const turnRefRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]/;
    const tokensRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]\s+AI返回 tokens:\s*(\d+)\+(\d+)=(\d+)/;
    const aiCallRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]\s+调用AI推理/;
    const aiTextRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]\s+AI(?:最终回复|文本):\s*(.+)/;
    const aiDurationRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]\s+AI推理完成，耗时:\s*(\d+)ms/;
    const metricsRe = /\[Metrics\]\s*AI调用:\s*\d+次,\s*tokens:\s*(\d+)\+(\d+)=(\d+)/;
    const metricsToolsRe = /\[Metrics\].*工具调用:\s*(\d+)次/;
    const timestampRe = /^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\]/;
    const userMsgRe = /\[(user:\S+|group:\S+)\]\s+收到消息:\s*(.+)/;
    const newSessionRe = /新建(?:飞书)?会话:\s*(user:\S+|group:\S+)/;
    const toolExecRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]\s+执行工具:\s*(\S+)\s*\|\s*参数:\s*(.+)$/;
    const toolDoneRe = /\[(?:(user:\S+|group:\S+)\s+)?Turn\s+(\d+)\]\s+工具完成:\s*(\S+)\s*\|\s*耗时:\s*(\d+)ms\s*\|\s*结果:\s*(.+)$/;

    const getSessionState = (sessionId: string): SessionState => {
      let state = sessionStates.get(sessionId);
      if (!state) {
        state = {
          sessionId,
          interactionId: 0,
          currentUserMessage: '',
          lastObservedTurn: 0
        };
        sessionStates.set(sessionId, state);
      }
      return state;
    };

    const getTimestampMs = (line: string): number | undefined => {
      const match = line.match(timestampRe);
      if (!match) return undefined;
      const value = new Date(match[1].replace(' ', 'T')).getTime();
      return Number.isNaN(value) ? undefined : value;
    };

    const extractSessionId = (line: string): string | undefined => {
      const directSession = line.match(/\[(user:\S+|group:\S+)\]/);
      if (directSession) return directSession[1];
      const sessionUser = line.match(/\[会话\s+(user:\S+|group:\S+)\]/);
      if (sessionUser) return sessionUser[1];
      const newSession = line.match(newSessionRe);
      if (newSession) return newSession[1];
      return undefined;
    };

    const resolveTurnRef = (line: string): { sessionId: string; interactionId: number; turn: number; turnKey: string } | null => {
      const match = line.match(turnRefRe);
      if (!match) return null;

      const sessionId = match[1] || extractSessionId(line) || lastSessionId;
      const turn = parseInt(match[2], 10);
      const state = getSessionState(sessionId);

      if (state.interactionId === 0) {
        state.interactionId = 1;
      } else if (turn === 1 && state.lastObservedTurn > turn) {
        state.interactionId += 1;
        state.currentUserMessage = '';
        state.lastObservedTurn = 0;
      }

      state.lastObservedTurn = Math.max(state.lastObservedTurn, turn);
      lastSessionId = sessionId;

      return {
        sessionId,
        interactionId: state.interactionId,
        turn,
        turnKey: `${sessionId}#${state.interactionId}#${turn}`
      };
    };

    const ensureTurn = (ref: { sessionId: string; interactionId: number; turn: number; turnKey: string }): TurnData => {
      let turnData = turns.get(ref.turnKey);
      if (!turnData) {
        const state = getSessionState(ref.sessionId);
        turnData = {
          turn: ref.turn,
          sessionId: ref.sessionId,
          interactionId: ref.interactionId,
          turnKey: ref.turnKey,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          aiDuration: 0,
          userMessage: state.currentUserMessage,
          aiResponse: '',
          tools: []
        };
        turns.set(ref.turnKey, turnData);
      }
      return turnData;
    };

    const addIssue = (issue: IssueData) => {
      const nextCount = (issueCounts.get(issue.type) || 0) + 1;
      issueCounts.set(issue.type, nextCount);

      if (issue.turnKey) {
        if (!turnIssueTypes.has(issue.turnKey)) {
          turnIssueTypes.set(issue.turnKey, new Set());
        }
        turnIssueTypes.get(issue.turnKey)!.add(issue.type);
      }

      if (nextCount <= MAX_ISSUE_EVIDENCE_PER_TYPE) {
        issues.push(issue);
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sessionId = extractSessionId(line);
      if (sessionId) {
        lastSessionId = sessionId;
        getSessionState(sessionId);
      }

      const tsMatch = line.match(timestampRe);
      if (tsMatch) {
        if (!startTime) startTime = tsMatch[1];
        endTime = tsMatch[1];
      }

      const userMatch = line.match(userMsgRe);
      if (userMatch) {
        const state = getSessionState(userMatch[1]);
        state.interactionId += 1;
        state.currentUserMessage = truncate(userMatch[2]);
        state.lastObservedTurn = 0;
        lastSessionId = userMatch[1];
      }

      const ctxMatch = line.match(turnContextRe);
      if (ctxMatch) {
        const turnRef = resolveTurnRef(line);
        if (turnRef) {
          ensureTurn(turnRef);
        }
      }

      const callMatch = line.match(aiCallRe);
      if (callMatch) {
        const turnRef = resolveTurnRef(line);
        if (turnRef) {
          ensureTurn(turnRef);
          const ts = getTimestampMs(line);
          if (ts !== undefined) {
            aiStartTimes.set(turnRef.turnKey, ts);
          }
        }
      }

      const replyMatch = line.match(aiTextRe);
      if (replyMatch) {
        const turnRef = resolveTurnRef(line);
        if (turnRef) {
          const td = ensureTurn(turnRef);
          const rawReplyText = replyMatch[3];
          const text = truncate(rawReplyText, 300);
          if (!td.aiResponse || /\(empty\)/i.test(td.aiResponse)) {
            td.aiResponse = text;
          } else if (/AI最终回复/.test(line)) {
            td.aiResponse = text;
          }
          if (/\(empty\)/i.test(rawReplyText)) {
            addIssue({
              type: 'empty_reply',
              severity: 'medium',
              turn: turnRef.turn,
              sessionId: turnRef.sessionId,
              interactionId: turnRef.interactionId,
              turnKey: turnRef.turnKey,
              description: truncate(line.trim(), 300)
            });
          }
        }
      }

      const tokMatch = line.match(tokensRe);
      if (tokMatch) {
        const turnRef = resolveTurnRef(line);
        if (turnRef) {
          const td = ensureTurn(turnRef);
          td.inputTokens = parseInt(tokMatch[2], 10);
          td.outputTokens = parseInt(tokMatch[3], 10);
          td.totalTokens = parseInt(tokMatch[4], 10);

          const callStart = aiStartTimes.get(turnRef.turnKey);
          const tokenTs = getTimestampMs(line);
          if ((!td.aiDuration || td.aiDuration === 0) && callStart !== undefined && tokenTs !== undefined && tokenTs >= callStart) {
            td.aiDuration = tokenTs - callStart;
          }
        }
      }

      const durMatch = line.match(aiDurationRe);
      if (durMatch) {
        const turnRef = resolveTurnRef(line);
        if (turnRef) {
          const td = ensureTurn(turnRef);
          td.aiDuration = parseInt(durMatch[2], 10);
        }
      }

      const toolExecMatch = line.match(toolExecRe);
      if (toolExecMatch) {
        const turnRef = resolveTurnRef(line);
        if (turnRef) {
          const td = ensureTurn(turnRef);
          td.tools.push({
            name: toolExecMatch[3],
            params: truncate(toolExecMatch[4], 150)
          });
        }
      }

      const toolDoneMatch = line.match(toolDoneRe);
      if (toolDoneMatch) {
        const turnRef = resolveTurnRef(line);
        const toolName = toolDoneMatch[3];
        const duration = parseInt(toolDoneMatch[4], 10);
        const result = truncate(toolDoneMatch[5], 200);
        const success = !/(失败|错误|error|fail|执行被阻止|denied|blocked)/i.test(result);

        if (turnRef) {
          const td = ensureTurn(turnRef);
          const pending = [...td.tools].reverse().find(tool => tool.name === toolName && tool.duration === undefined);
          if (pending) {
            pending.duration = duration;
            pending.success = success;
            pending.result = result;
          } else {
            td.tools.push({ name: toolName, duration, success, result });
          }
          if (!success) {
            addIssue({
              type: 'tool_failure',
              severity: 'medium',
              turn: turnRef.turn,
              sessionId: turnRef.sessionId,
              interactionId: turnRef.interactionId,
              turnKey: turnRef.turnKey,
              description: truncate(`工具 ${toolName} 执行失败: ${toolDoneMatch[5]}`, 300)
            });
          }
          if (duration >= 10000) {
            addIssue({
              type: 'slow_tool',
              severity: duration >= 30000 ? 'high' : 'medium',
              turn: turnRef.turn,
              sessionId: turnRef.sessionId,
              interactionId: turnRef.interactionId,
              turnKey: turnRef.turnKey,
              description: `工具 ${toolName} 耗时 ${duration}ms，存在明显卡顿`
            });
          }
        }

        if (!toolAgg.has(toolName)) {
          toolAgg.set(toolName, { count: 0, successes: 0, failures: 0, totalDuration: 0 });
        }
        const agg = toolAgg.get(toolName)!;
        agg.count++;
        agg.totalDuration += duration;
        if (success) agg.successes++;
        else agg.failures++;
      }

      const mMatch = line.match(metricsRe);
      if (mMatch) {
        metricsInput += parseInt(mMatch[1], 10);
        metricsOutput += parseInt(mMatch[2], 10);
      }
      const mtMatch = line.match(metricsToolsRe);
      if (mtMatch) {
        metricsToolCalls += parseInt(mtMatch[1], 10);
      }

      if (/timeout|超时/i.test(line)) {
        const turnRef = resolveTurnRef(line);
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length - 1, i + 2);
        const ctx = lines.slice(contextStart, contextEnd + 1).map(l => l.trim()).filter(l => l.length > 0).join('\n');
        addIssue({
          type: 'timeout',
          severity: 'high',
          turn: turnRef?.turn || 0,
          sessionId: turnRef?.sessionId,
          interactionId: turnRef?.interactionId,
          turnKey: turnRef?.turnKey,
          description: truncate(line.trim(), 300),
          context: truncate(ctx, MAX_ISSUE_CONTEXT_LENGTH)
        });
      }

      if (/\bkill\b/i.test(line) && !/\bskill\b/i.test(line)) {
        const turnRef = resolveTurnRef(line);
        addIssue({
          type: 'user_kill',
          severity: 'high',
          turn: turnRef?.turn || 0,
          sessionId: turnRef?.sessionId,
          interactionId: turnRef?.interactionId,
          turnKey: turnRef?.turnKey,
          description: truncate(line.trim(), 300)
        });
      }

      if (/429/.test(line) && /限流|重试/i.test(line)) {
        const turnRef = resolveTurnRef(line);
        addIssue({
          type: 'rate_limited_retry',
          severity: 'medium',
          turn: turnRef?.turn || 0,
          sessionId: turnRef?.sessionId,
          interactionId: turnRef?.interactionId,
          turnKey: turnRef?.turnKey,
          description: truncate(line.trim(), 300)
        });
      }

      if (/执行被阻止: 读取路径超出工作目录/.test(line)) {
        const turnRef = resolveTurnRef(line);
        addIssue({
          type: 'outside_read_blocked',
          severity: 'medium',
          turn: turnRef?.turn || 0,
          sessionId: turnRef?.sessionId,
          interactionId: turnRef?.interactionId,
          turnKey: turnRef?.turnKey,
          description: '尝试读取工作目录外文件，但被路径策略拦截'
        });
      }

      if (/不是内部或外部命令/.test(line) && /\b(head|tail|find|grep|ls)\b/i.test(line)) {
        const turnRef = resolveTurnRef(line);
        addIssue({
          type: 'platform_command_mismatch',
          severity: 'medium',
          turn: turnRef?.turn || 0,
          sessionId: turnRef?.sessionId,
          interactionId: turnRef?.interactionId,
          turnKey: turnRef?.turnKey,
          description: truncate(line.trim(), 300)
        });
      }

      if (/API调用失败|Connection error|\bENOTFOUND\b|认证失败|getaddrinfo/i.test(line)) {
        const turnRef = resolveTurnRef(line);
        addIssue({
          type: 'api_or_network_failure',
          severity: /\bENOTFOUND\b|Connection error|getaddrinfo/i.test(line) ? 'high' : 'medium',
          turn: turnRef?.turn || 0,
          sessionId: turnRef?.sessionId,
          interactionId: turnRef?.interactionId,
          turnKey: turnRef?.turnKey,
          description: truncate(line.trim(), 300)
        });
      }

      if (/\berror\b|\b错误\b|\b失败\b/i.test(line) && !/工具参数解析错误/.test(line) && !/API调用失败/.test(line)) {
        const turnRef = resolveTurnRef(line);
        addIssue({
          type: 'error',
          severity: 'medium',
          turn: turnRef?.turn || 0,
          sessionId: turnRef?.sessionId,
          interactionId: turnRef?.interactionId,
          turnKey: turnRef?.turnKey,
          description: truncate(line.trim(), 300)
        });
      }
    }

    for (const [name, agg] of toolAgg) {
      if (agg.failures >= 3) {
        addIssue({
          type: 'repeated_tool_failures',
          severity: agg.failures >= 5 ? 'high' : 'medium',
          turn: 0,
          description: `工具 ${name} 失败 ${agg.failures} 次，存在稳定性问题`
        });
      }
      if (agg.count >= 3 && agg.totalDuration / agg.count >= 5000) {
        addIssue({
          type: 'slow_tool_pattern',
          severity: 'medium',
          turn: 0,
          description: `工具 ${name} 平均耗时 ${Math.round(agg.totalDuration / agg.count)}ms，整体偏慢`
        });
      }
    }

    const toolStats = Array.from(toolAgg.entries())
      .map(([name, agg]) => ({
        name,
        count: agg.count,
        successes: agg.successes,
        failures: agg.failures,
        avgDuration: Math.round(agg.totalDuration / agg.count)
      }))
      .sort((a, b) => {
        if (b.failures !== a.failures) return b.failures - a.failures;
        return b.count - a.count;
      });

    const turnsArray = Array.from(turns.values())
      .sort((a, b) => {
        if ((a.sessionId || '') !== (b.sessionId || '')) {
          return (a.sessionId || '').localeCompare(b.sessionId || '');
        }
        if ((a.interactionId || 0) !== (b.interactionId || 0)) {
          return (a.interactionId || 0) - (b.interactionId || 0);
        }
        return a.turn - b.turn;
      })
      .map(turn => ({
        ...turn,
        issueTypes: turn.turnKey ? Array.from(turnIssueTypes.get(turn.turnKey) || []) : []
      }));
    const totalAiDuration = turnsArray.reduce((sum, t) => sum + (t.aiDuration || 0), 0);
    const issueCountsObject = Object.fromEntries([...issueCounts.entries()].sort((a, b) => b[1] - a[1]));
    const interactionCount = [...sessionStates.values()].reduce((sum, state) => sum + state.interactionId, 0);

    const deepTurns = this.selectTurnsForDeep(turnsArray);

    const summary = {
      totalTurns: turns.size,
      totalTokens: metricsInput + metricsOutput,
      inputTokens: metricsInput,
      outputTokens: metricsOutput,
      toolCalls: metricsToolCalls || toolStats.reduce((s, t) => s + t.count, 0),
      totalDuration: Math.round(totalAiDuration / 1000 * 100) / 100,
      startTime,
      endTime,
      sessionCount: sessionStates.size,
      interactionCount,
      issueCount: [...issueCounts.values()].reduce((sum, count) => sum + count, 0),
      issueCounts: issueCountsObject,
      returnedTurns: depth === 'deep' ? deepTurns.length : undefined,
      truncatedTurns: depth === 'deep' ? deepTurns.length < turnsArray.length : undefined
    };

    const sortedIssues = issues.sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      if (severityRank[b.severity] !== severityRank[a.severity]) {
        return severityRank[b.severity] - severityRank[a.severity];
      }
      if ((a.sessionId || '') !== (b.sessionId || '')) {
        return (a.sessionId || '').localeCompare(b.sessionId || '');
      }
      if ((a.interactionId || 0) !== (b.interactionId || 0)) {
        return (a.interactionId || 0) - (b.interactionId || 0);
      }
      return a.turn - b.turn;
    });

    return {
      summary,
      toolStats,
      issues: sortedIssues,
      ...(depth === 'deep' ? { turns: deepTurns } : {})
    };
  }

  private extractTurnNumber(line: string): number {
    const match = line.match(/Turn\s+(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
