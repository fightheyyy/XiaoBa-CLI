import * as path from 'path';
import {
  ArtifactManifestItem,
  Tool,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionOutput,
} from '../../../types/tool';
import {
  LongTermMemoryKind,
  MemoryFinalizer,
} from '../../../utils/memory-finalizer';
import { toolFailure, toolSuccess } from '../../../tools/tool-result';

const MEMORY_KINDS = new Set<LongTermMemoryKind>([
  'preference',
  'habit',
  'instruction',
  'fact',
]);

interface RememberToolResult {
  ok: true;
  action: 'created' | 'updated';
  memory_path: string;
  record_id: string;
  kind: LongTermMemoryKind;
  text: string;
  total_records: number;
  load_policy: 'on_demand';
}

export class EvolutionRememberTool implements Tool {
  definition: ToolDefinition = {
    name: 'remember',
    description: 'EvolutionCat 专属确定性工具：把用户明确要求长期记住的稳定偏好、习惯、指令或事实写入当前 session/person 的长期记忆。不要用于当前任务进度或临时待办。',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要长期记住的单条稳定内容。',
        },
        kind: {
          type: 'string',
          enum: ['preference', 'habit', 'instruction', 'fact'],
          description: '可选分类；省略时由 runtime 确定性分类。',
        },
      },
      required: ['content'],
    },
  };

  async execute(args: any, context: ToolExecutionContext): Promise<ToolExecutionOutput> {
    const content = typeof args?.content === 'string' ? args.content.trim() : '';
    if (!content) {
      return toolFailure('remember 需要非空 content。', 'INVALID_TOOL_ARGUMENTS');
    }

    const parentSessionId = typeof context.parentSessionId === 'string'
      ? context.parentSessionId.trim()
      : '';
    const sessionId = parentSessionId
      || (typeof context.sessionId === 'string' ? context.sessionId.trim() : '');
    if (!sessionId) {
      return toolFailure('remember 需要 runtime 提供 sessionId。', 'SESSION_ID_REQUIRED');
    }

    const kind = normalizeKind(args?.kind);
    if (args?.kind !== undefined && !kind) {
      return toolFailure('kind 必须是 preference、habit、instruction 或 fact。', 'INVALID_TOOL_ARGUMENTS');
    }

    try {
      const result = MemoryFinalizer.remember(sessionId, content, {
        ...(kind ? { kind } : {}),
        rootDir: context.workingDirectory,
      });
      const payload: RememberToolResult = {
        ok: true,
        action: result.action,
        memory_path: displayPath(result.memoryPath, context.workingDirectory),
        record_id: result.record.id,
        kind: result.record.kind,
        text: result.record.text,
        total_records: result.totalRecords,
        load_policy: 'on_demand',
      };
      return toolSuccess(JSON.stringify(payload, null, 2));
    } catch (error: any) {
      return toolFailure(
        `remember 写入失败：${error?.message || String(error)}`,
        'MEMORY_WRITE_FAILED',
      );
    }
  }

  getArtifactManifest(
    _args: any,
    result: string,
    _context: ToolExecutionContext,
  ): ArtifactManifestItem[] {
    const payload = parseResult(result);
    if (!payload) return [];
    return [{
      path: payload.memory_path,
      type: 'md',
      action: payload.action,
      metadata: {
        artifact_role: 'session_person_memory',
        record_id: payload.record_id,
        kind: payload.kind,
      },
    }];
  }
}

function normalizeKind(value: unknown): LongTermMemoryKind | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim() as LongTermMemoryKind;
  return MEMORY_KINDS.has(normalized) ? normalized : undefined;
}

function displayPath(filePath: string, workingDirectory: string): string {
  const relative = path.relative(workingDirectory, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : filePath;
}

function parseResult(result: string): RememberToolResult | undefined {
  try {
    const payload = JSON.parse(result) as Partial<RememberToolResult>;
    if (
      payload.ok === true
      && typeof payload.memory_path === 'string'
      && typeof payload.record_id === 'string'
      && (payload.action === 'created' || payload.action === 'updated')
      && typeof payload.kind === 'string'
    ) {
      return payload as RememberToolResult;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
