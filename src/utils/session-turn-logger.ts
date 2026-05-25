import * as fs from 'fs';
import * as path from 'path';
import { Message, ContentBlock } from '../types';

const SESSION_LOG_DIR = path.join('logs', 'sessions');
const MAX_TOOL_RESULT_LENGTH = Number(process.env.XIAOBA_SESSION_TOOL_RESULT_LIMIT || 10000);
const SESSION_LOG_SCHEMA_VERSION = 2;

type ToolCallStatus = 'success' | 'failure';
type ArtifactAction = 'created' | 'updated' | 'sent';

interface ArtifactManifestItem {
  path: string;
  type: string;
  action: ArtifactAction;
}

export interface SessionTurnLogEntry {
  schema_version: number;
  entry_type: 'turn';
  turn_id: string;
  turn: number;
  timestamp: string;
  session_id: string;
  session_type: string;
  user: {
    text: string;
    images?: string[];
  };
  assistant: {
    text: string;
    tool_calls: ToolCallLog[];
  };
  tokens: {
    prompt: number;
    completion: number;
  };
}

export interface SessionRuntimeLogEntry {
  schema_version: number;
  entry_type: 'runtime';
  event_id: string;
  timestamp: string;
  session_id: string;
  session_type: string;
  level: string;
  message: string;
}

export type SessionLogEntry = SessionTurnLogEntry | SessionRuntimeLogEntry;

interface ToolCallLog {
  id: string;
  tool_call_id?: string;
  name: string;
  arguments: any;
  result: string;
  duration_ms?: number;
  status?: ToolCallStatus;
  error_code?: string;
  artifact_manifest?: ArtifactManifestItem[];
  skill_id?: string;
}

/**
 * SessionTurnLogger - 记录每轮对话的完整交互
 *
 * 默认开启，永久保留，用于分析、日报生成、skill 提取
 */
export class SessionTurnLogger {
  private sessionType: string;
  private sessionId: string;
  private logFilePath: string;
  private turnCounter = 0;

  constructor(sessionType: string, sessionId: string) {
    this.sessionType = sessionType;
    this.sessionId = sessionId;

    const date = new Date();
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dir = path.join(path.resolve(SESSION_LOG_DIR), sessionType, dateStr);

    fs.mkdirSync(dir, { recursive: true });
    const safeSessionId = sessionId.replace(/[:<>"|?*]/g, '_');
    this.logFilePath = path.join(dir, `${sessionType}_${safeSessionId}.jsonl`);
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * 记录一轮对话
   */
  logTurn(
    userInput: string | ContentBlock[],
    assistantText: string,
    toolCalls: ToolCallLog[],
    tokens: { prompt: number; completion: number }
  ): void {
    this.turnCounter++;
    const turnId = `${this.safeId(this.sessionId)}.turn.${this.turnCounter}`;

    const userText = this.extractText(userInput);
    const userImages = this.extractImages(userInput);

    const turnLog: SessionTurnLogEntry = {
      schema_version: SESSION_LOG_SCHEMA_VERSION,
      entry_type: 'turn',
      turn_id: turnId,
      turn: this.turnCounter,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      session_type: this.sessionType,
      user: {
        text: userText,
        ...(userImages.length > 0 && { images: userImages }),
      },
      assistant: {
        text: assistantText,
        tool_calls: toolCalls.map((tc, index) => this.normalizeToolCall(tc, turnId, index)),
      },
      tokens,
    };

    this.appendLog(turnLog);
  }

  logRuntime(level: string, message: string): void {
    const runtimeEntry: SessionRuntimeLogEntry = {
      schema_version: SESSION_LOG_SCHEMA_VERSION,
      entry_type: 'runtime',
      event_id: `${this.safeId(this.sessionId)}.runtime.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      session_type: this.sessionType,
      level,
      message,
    };
    this.appendLog(runtimeEntry);
  }

  private extractText(content: string | ContentBlock[]): string {
    if (typeof content === 'string') return content;
    return content
      .filter(block => block.type === 'text')
      .map(block => (block as any).text)
      .join('');
  }

  private extractImages(content: string | ContentBlock[]): string[] {
    if (typeof content === 'string') return [];
    return content
      .filter(block => block.type === 'image')
      .map((block, idx) => `image_${idx}`);
  }

  private normalizeToolCall(tc: ToolCallLog, turnId: string, index: number): ToolCallLog {
    const result = this.truncate(String(tc.result ?? ''), MAX_TOOL_RESULT_LENGTH);
    const status = tc.status || this.inferToolStatus(result);
    const errorCode = tc.error_code || this.inferErrorCode(result);
    const artifactManifest = tc.artifact_manifest?.length
      ? tc.artifact_manifest.map(item => ({
        ...item,
        path: this.redactPath(item.path),
      }))
      : this.inferArtifactManifest(tc.name, tc.arguments, result);

    return {
      ...tc,
      tool_call_id: tc.tool_call_id || tc.id || `${turnId}.tool.${index + 1}`,
      result,
      status,
      ...(errorCode && { error_code: errorCode }),
      ...(artifactManifest.length > 0 && { artifact_manifest: artifactManifest }),
      ...(tc.skill_id && { skill_id: tc.skill_id }),
    };
  }

  private inferToolStatus(result: string): ToolCallStatus {
    return /(失败|错误|error|fail|denied|blocked|not recognized|不是内部或外部命令|timeout|超时)/i.test(result)
      ? 'failure'
      : 'success';
  }

  private inferErrorCode(result: string): string | undefined {
    if (/timeout|超时/i.test(result)) return 'TOOL_TIMEOUT';
    if (/429|rate limit|too many requests|限流/i.test(result)) return 'RATE_LIMIT';
    if (/读取路径超出工作目录|outside.*workspace|permission denied|denied|blocked/i.test(result)) return 'PATH_DENIED';
    if (/not recognized as an internal or external command|不是内部或外部命令/i.test(result)) return 'PLATFORM_COMMAND_MISMATCH';
    if (/API调用失败|Connection error|ENOTFOUND|ECONNRESET|ETIMEDOUT|PROVIDER_ERROR/i.test(result)) return 'PROVIDER_ERROR';
    if (/(失败|错误|error|fail)/i.test(result)) return 'TOOL_ERROR';
    return undefined;
  }

  private inferArtifactManifest(toolName: string, args: any, result: string): ArtifactManifestItem[] {
    const action = this.inferArtifactAction(toolName, result);
    if (!action) return [];

    const includeArgs = /^(send_file|write_file|edit_file)$/i.test(toolName);
    const paths = includeArgs
      ? [...this.extractArtifactPaths(this.stringify(args)), ...this.extractArtifactPaths(result)]
      : this.extractArtifactPaths(result);

    return this.unique(paths)
      .map(filePath => ({
        path: this.redactPath(filePath),
        type: this.artifactType(filePath),
        action,
      }))
      .slice(0, 20);
  }

  private inferArtifactAction(toolName: string, result: string): ArtifactAction | undefined {
    if (toolName === 'send_file') return 'sent';
    if (/^(write_file|edit_file)$/i.test(toolName)) return 'updated';
    if (/saved|created|generated|wrote|写入|保存|生成|导出/i.test(result)) return 'created';
    return undefined;
  }

  private extractArtifactPaths(text: string): string[] {
    const matches = text.match(/(?:[A-Za-z]:[\\/]+[^\s"'`]+|\/[^\s"'`]+|[\w.-]+\/[^\s"'`]+|[\w.-]+\.(?:png|pdf|r|R|csv|tsv|xlsx|html|zip|rds|Rds|RDS))/g) || [];
    return matches
      .filter(value => /\.(?:png|pdf|r|R|csv|tsv|xlsx|html|zip|rds|Rds|RDS)(?:$|[?#])/i.test(value))
      .map(value => value.replace(/\\/g, '/').replace(/[),.;:]+$/g, ''))
      .filter(Boolean);
  }

  private artifactType(filePath: string): string {
    const match = filePath.match(/\.([A-Za-z0-9]+)(?:$|[?#])/);
    return match ? match[1].toLowerCase() : 'file';
  }

  private stringify(value: any): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private redactPath(value: string): string {
    return value
      .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\\\s"']+/g, '$1[USER]')
      .replace(/\/(?:Users|home|share\/home)\/[^/\s"']+/g, match => {
        const prefix = match.startsWith('/share/home/') ? '/share/home' : match.startsWith('/Users/') ? '/Users' : '/home';
        return `${prefix}/[USER]`;
      });
  }

  private safeId(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '... [truncated]';
  }

  private appendLog(entry: SessionLogEntry): void {
    try {
      fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n');
    } catch (error) {
      // 日志写入失败不影响主流程
      console.error('[SessionTurnLogger] Failed to write log:', error);
    }
  }
}
