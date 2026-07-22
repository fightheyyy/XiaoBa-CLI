import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AIService } from '../../../utils/ai-service';
import { SkillManager } from '../../../skills/skill-manager';
import { buildCanonicalToolResult } from '../../../tools/tool-result';
import type { AgentServices } from '../../../core/agent-session';
import type {
  TraceReplayReport,
  TraceReplayRunOptions,
} from '../../../replay/trace-replay-runner';
import { runIsolatedTraceReplay } from '../../../replay/isolated-trace-replay';
import {
  ArtifactManifestItem,
  Tool,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolResult,
} from '../../../types/tool';

const DAG_PARENT_PATTERN = /^evolution:dag:(\d{4}-\d{2}-\d{2})$/;
const MAX_SOURCE_TRACES = 5;
const READ_ONLY_REPLAY_TOOLS = new Set(['read_file', 'grep', 'glob']);

interface FrozenReplayCase {
  id: string;
  intent: string;
  expected_outcome: string;
  source_trace_refs: string[];
}

interface ReviewerTraceReplayDependencies {
  replay?: (options: TraceReplayRunOptions) => Promise<TraceReplayReport>;
}

export class ReviewerTraceReplayTool implements Tool {
  definition: ToolDefinition = {
    name: 'reviewer_trace_replay',
    description: [
      '定时 evolution DAG 专用的确定性正式回放入口。',
      '只接受空参数；runtime 从可信 parentSessionId 推导当日 inspector-route.json，读取其中冻结的 Replay Case/source trace，并把 fresh artifacts 写到固定 reviewer-replay/ 目录。',
      '回放 Agent 只可使用 read_file/grep/glob，不能写文件、执行 Shell、派遣子角色或外发。普通 Reviewer 会话不能调用。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {},
    },
  };

  constructor(private readonly dependencies: ReviewerTraceReplayDependencies = {}) {}

  async execute(args: any, context: ToolExecutionContext): Promise<string | ToolExecutionOutput> {
    const date = evolutionDagDate(context);
    if (!date) {
      return blocked(
        'REVIEWER_TRACE_REPLAY_REQUIRES_EVOLUTION_DAG',
        'reviewer_trace_replay 只能由可信 evolution:dag:<date> parent session 调用。',
      );
    }
    if (!isEmptyObject(args)) {
      return blocked(
        'REVIEWER_TRACE_REPLAY_REJECTED_ARGUMENTS',
        'reviewer_trace_replay 只接受空参数；Inspector 路径、source trace、cwd 和命令都由 runtime 冻结。',
      );
    }

    let ownedReplayRoot: { root: string; replayRoot: string } | undefined;
    try {
      const root = fs.realpathSync(path.resolve(context.workingDirectory));
      const runRoot = resolveExistingInside(root, path.join(root, 'output', 'evolution', 'sleep', date), 'DAG run root');
      const inspectorPath = resolveExistingInside(root, path.join(runRoot, 'inspector-route.json'), 'Inspector route');
      const inspector = readObject(inspectorPath, 'Inspector route');
      const replayCase = parseFrozenReplayCase(inspector);
      const sourceLines = replayCase.source_trace_refs.map(ref => readFrozenTraceLine(root, ref));
      validateFrozenTraceSequence(sourceLines);
      if (sourceLines.some(item => item.userText.startsWith('/'))) {
        throw new Error('Replay Case contains a slash command, which is not allowed in deterministic read-only replay');
      }
      const targetRole = resolveReplayRole(root, sourceLines);
      const sideEffecting = sourceLines.find(item => item.toolNames.some(name => !READ_ONLY_REPLAY_TOOLS.has(name)));
      if (sideEffecting) {
        const unsupported = sideEffecting.toolNames.filter(name => !READ_ONLY_REPLAY_TOOLS.has(name));
        throw new Error(`Replay Case requires non-read-only tools (${unsupported.join(', ')}); deterministic replay must fail closed`);
      }

      const replayRoot = path.join(runRoot, 'reviewer-replay');
      ownedReplayRoot = { root, replayRoot };
      removeOwnedReplayRoot(root, replayRoot);
      fs.mkdirSync(replayRoot, { recursive: true });
      const realReplayRoot = fs.realpathSync(replayRoot);
      ensureInside(root, realReplayRoot, 'Reviewer replay output');

      const replayCasePath = path.join(replayRoot, 'replay-case.json');
      const frozenTracePath = path.join(replayRoot, 'source-trace.jsonl');
      fs.writeFileSync(replayCasePath, `${JSON.stringify({ version: 1, ...replayCase }, null, 2)}\n`, 'utf-8');
      fs.writeFileSync(frozenTracePath, `${sourceLines.map(item => item.line).join('\n')}\n`, 'utf-8');

      const sessionKey = `pet:xiaoba:role-${targetRole || 'base'}:evolution-replay-${date.replace(/-/g, '')}-${crypto.randomUUID()}`;
      const report = this.dependencies.replay
        ? await this.dependencies.replay({
          tracePath: frozenTracePath,
          outDir: replayRoot,
          cwd: root,
          sessionKey,
          source: 'evolution-reviewer-trace-replay',
          maxTurns: sourceLines.length,
          timeoutMs: 120_000,
          services: await createReadOnlyReplayServices(root, context.parentSessionId || '', targetRole),
        })
        : runIsolatedTraceReplay({
          codeRoot: root,
          tracePath: frozenTracePath,
          outDir: replayRoot,
          parentSessionId: context.parentSessionId || '',
          ...(targetRole ? { targetRole } : {}),
          sessionKey,
          source: 'evolution-reviewer-trace-replay',
          maxTurns: sourceLines.length,
          timeoutMs: 120_000,
        });

      const expectedReportPath = path.join(replayRoot, 'report.md');
      const expectedManifestPath = path.join(replayRoot, 'manifest.json');
      const expectedComparisonPath = path.join(replayRoot, 'comparison.json');
      for (const artifact of [expectedReportPath, expectedManifestPath, expectedComparisonPath]) {
        const realArtifact = resolveExistingInside(root, artifact, 'Reviewer replay artifact');
        ensureInside(realReplayRoot, realArtifact, 'Reviewer replay artifact');
      }
      if (path.resolve(report.out_dir) !== realReplayRoot) {
        throw new Error('Trace Replay returned an output directory outside the frozen reviewer-replay root');
      }
      const attemptedUnsafeTools = [...new Set(
        report.results.flatMap(result => result.tools)
          .filter(name => !READ_ONLY_REPLAY_TOOLS.has(name)),
      )];
      if (attemptedUnsafeTools.length > 0) {
        throw new Error(`Read-only replay attempted forbidden tools (${attemptedUnsafeTools.join(', ')}); formal replay is blocked`);
      }

      return [
        'reviewer_trace_replay: status=completed',
        `replay_case_id=${replayCase.id}`,
        `target_role=${targetRole || 'base'}`,
        `replayed_turns=${report.replayed_turns}`,
        `report_ref=${relativeRef(expectedReportPath, root)}`,
        `manifest_ref=${relativeRef(expectedManifestPath, root)}`,
        `comparison_ref=${relativeRef(expectedComparisonPath, root)}`,
      ].join('\n');
    } catch (error: any) {
      if (ownedReplayRoot) {
        try {
          removeOwnedReplayRoot(ownedReplayRoot.root, ownedReplayRoot.replayRoot);
        } catch {
          // Preserve the original fail-closed reason; stale evidence is never accepted.
        }
      }
      return blocked(
        'REVIEWER_TRACE_REPLAY_BLOCKED',
        String(error?.message || error || 'deterministic trace replay failed'),
      );
    }
  }

  getArtifactManifest(_args: any, result: string | ToolExecutionOutput, context: ToolExecutionContext): ArtifactManifestItem[] {
    if (typeof result !== 'string' || !result.includes('status=completed')) return [];
    const date = evolutionDagDate(context);
    if (!date) return [];
    const base = path.join('output', 'evolution', 'sleep', date, 'reviewer-replay');
    return [
      artifact(`${base}/replay-case.json`, 'generated', 'frozen_replay_case'),
      artifact(`${base}/source-trace.jsonl`, 'captured', 'frozen_source_trace'),
      artifact(`${base}/manifest.json`, 'generated', 'replay_manifest'),
      artifact(`${base}/extracted-inputs.json`, 'generated', 'replay_inputs'),
      artifact(`${base}/replay-results.json`, 'generated', 'replay_results'),
      artifact(`${base}/comparison.json`, 'generated', 'replay_comparison'),
      artifact(`${base}/report.md`, 'generated', 'replay_report'),
    ].filter(item => fs.existsSync(path.resolve(context.workingDirectory, item.path)));
  }
}

export async function createReadOnlyReplayServices(
  root: string,
  parentSessionId: string,
  roleName?: string,
): Promise<AgentServices> {
  // Load ToolManager only after the role registry has finished initializing.
  // runtime-role-registry owns this tool, while ToolManager's subagent path
  // reaches that registry; a static import here would form a module cycle.
  const { ToolManager } = await import('../../../tools/tool-manager');
  class ReadOnlyReplayToolManager extends ToolManager {
    constructor() {
      super(
        root,
        {
          surface: 'agent',
          permissionProfile: 'strict',
          parentSessionId,
          ...(roleName ? { roleName } : {}),
        },
        [],
        {
          inheritBaseTools: false,
          baseToolAllowlist: [...READ_ONLY_REPLAY_TOOLS],
        },
      );
    }

    override getToolDefinitions(contextOverrides = {}): ToolDefinition[] {
      return super.getToolDefinitions(contextOverrides)
        .filter(definition => READ_ONLY_REPLAY_TOOLS.has(definition.name));
    }

    override async executeTool(
      toolCall: ToolCall,
      conversationHistory?: any[],
      contextOverrides = {},
    ): Promise<ToolResult> {
      if (!READ_ONLY_REPLAY_TOOLS.has(toolCall.function.name)) {
        const reason = `${toolCall.function.name} is forbidden in deterministic Reviewer trace replay`;
        return buildCanonicalToolResult({
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: `执行被阻止: ${reason}`,
          status: 'blocked',
          errorCode: 'REVIEWER_TRACE_REPLAY_TOOL_FORBIDDEN',
          blockedReason: reason,
          retryable: false,
        });
      }
      return super.executeTool(toolCall, conversationHistory, contextOverrides);
    }
  }

  return {
    aiService: new AIService(),
    toolManager: new ReadOnlyReplayToolManager(),
    skillManager: new SkillManager(roleName),
    ...(roleName ? { roleName } : {}),
  };
}

function evolutionDagDate(context: ToolExecutionContext): string | undefined {
  return DAG_PARENT_PATTERN.exec(context.parentSessionId || '')?.[1];
}

function parseFrozenReplayCase(inspector: Record<string, unknown>): FrozenReplayCase {
  if (inspector.version !== 1 || (inspector.route !== 'repair' && inspector.route !== 'replay')) {
    throw new Error('Inspector route is not a version 1 repair/replay decision');
  }
  const replay = asObject(inspector.replay_case, 'Inspector replay_case');
  const id = requiredString(replay.id, 'replay_case.id');
  if (!/^[a-zA-Z0-9._-]{1,96}$/.test(id)) {
    throw new Error('replay_case.id is not a safe stable id');
  }
  const sourceTraceRefs = uniqueStrings(replay.source_trace_refs);
  if (sourceTraceRefs.length === 0 || sourceTraceRefs.length > MAX_SOURCE_TRACES) {
    throw new Error(`replay_case.source_trace_refs must contain 1-${MAX_SOURCE_TRACES} refs`);
  }
  const inspectorEvidence = new Set(uniqueStrings(inspector.evidence_refs));
  if (sourceTraceRefs.some(ref => !inspectorEvidence.has(ref))) {
    throw new Error('replay_case.source_trace_refs must be frozen Inspector evidence_refs');
  }
  return {
    id,
    intent: requiredString(replay.intent, 'replay_case.intent'),
    expected_outcome: requiredString(replay.expected_outcome, 'replay_case.expected_outcome'),
    source_trace_refs: sourceTraceRefs,
  };
}

function readFrozenTraceLine(root: string, ref: string): {
  line: string;
  userText: string;
  sessionId: string;
  sessionType: string;
  timestampMs: number;
  sequence?: number;
  roleName?: string;
  toolNames: string[];
} {
  const hashIndex = ref.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === ref.length - 1) {
    throw new Error(`source trace ref must use <workspace path>#<trace id>: ${ref}`);
  }
  const filePart = ref.slice(0, hashIndex);
  const traceId = ref.slice(hashIndex + 1);
  const tracePath = resolveExistingInside(root, path.resolve(root, filePart), 'Source trace');
  if (path.basename(tracePath) !== 'traces.jsonl') {
    throw new Error(`source trace must reference a traces.jsonl file: ${ref}`);
  }
  const matches: Array<{
    line: string;
    userText: string;
    sessionId: string;
    sessionType: string;
    timestampMs: number;
    sequence?: number;
    roleName?: string;
    toolNames: string[];
  }> = [];
  for (const line of fs.readFileSync(tracePath, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const candidateId = String(value.trace_id || value.episode_id || value.turn_id || '').trim();
    if (candidateId !== traceId) continue;
    const user = value.user && typeof value.user === 'object' && !Array.isArray(value.user)
      ? value.user as Record<string, unknown>
      : {};
    const userText = requiredString(user.text, `source trace ${traceId} user.text`);
    const sessionId = requiredString(value.session_id, `source trace ${traceId} session_id`);
    const sessionType = requiredString(value.session_type, `source trace ${traceId} session_type`);
    const timestampMs = Date.parse(requiredString(value.timestamp, `source trace ${traceId} timestamp`));
    if (!Number.isFinite(timestampMs)) {
      throw new Error(`source trace ${traceId} timestamp is invalid`);
    }
    const rawSequence = value.trace_index ?? value.turn ?? value.episode_index;
    const sequence = typeof rawSequence === 'number' && Number.isFinite(rawSequence)
      ? rawSequence
      : undefined;
    const assistant = value.assistant && typeof value.assistant === 'object' && !Array.isArray(value.assistant)
      ? value.assistant as Record<string, unknown>
      : {};
    const toolNames = Array.isArray(assistant.tool_calls)
      ? assistant.tool_calls
        .map(call => call && typeof call === 'object' && !Array.isArray(call)
          ? String((call as Record<string, unknown>).name || '').trim()
          : '')
        .filter(Boolean)
      : [];
    matches.push({
      line,
      userText,
      sessionId,
      sessionType,
      timestampMs,
      ...(sequence !== undefined ? { sequence } : {}),
      ...(traceRoleName(value) ? { roleName: traceRoleName(value) } : {}),
      toolNames: [...new Set(toolNames)],
    });
  }
  if (matches.length !== 1) {
    throw new Error(`source trace ref must resolve to exactly one trace row: ${ref}`);
  }
  return matches[0];
}

function validateFrozenTraceSequence(sourceLines: Array<{
  sessionId: string;
  sessionType: string;
  timestampMs: number;
  sequence?: number;
}>): void {
  const sessions = new Set(sourceLines.map(item => `${item.sessionType}\0${item.sessionId}`));
  if (sessions.size !== 1) {
    throw new Error('Replay Case source traces must come from one original session');
  }
  for (let index = 1; index < sourceLines.length; index += 1) {
    const previous = sourceLines[index - 1];
    const current = sourceLines[index];
    const timestampOrdered = previous.timestampMs < current.timestampMs;
    const sameTimestampOrdered = previous.timestampMs === current.timestampMs
      && previous.sequence !== undefined
      && current.sequence !== undefined
      && previous.sequence < current.sequence;
    if (!timestampOrdered && !sameTimestampOrdered) {
      throw new Error('Replay Case source traces must preserve strict original turn order');
    }
  }
}

function traceRoleName(trace: Record<string, unknown>): string | undefined {
  const candidates: unknown[] = [trace.role_name];
  if (Array.isArray(trace.tool_visibility)) {
    for (const item of [...trace.tool_visibility].reverse()) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        candidates.push((item as Record<string, unknown>).roleName);
      }
    }
  }
  if (Array.isArray(trace.events)) {
    for (const item of [...trace.events].reverse()) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        candidates.push((item as Record<string, unknown>).role_name);
      }
    }
  }
  const sessionId = typeof trace.session_id === 'string' ? trace.session_id : '';
  const sessionRole = /(?:^|:)role-([^:]+)/.exec(sessionId)?.[1];
  if (sessionRole) candidates.push(sessionRole);

  for (const candidate of candidates) {
    const normalized = String(candidate || '')
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
    if (!normalized) continue;
    return normalized === 'role-base' || normalized === 'main' ? 'base' : normalized;
  }
  return undefined;
}

function resolveReplayRole(
  root: string,
  sourceLines: Array<{ roleName?: string }>,
): string | undefined {
  const roles = [...new Set(
    sourceLines
      .map(item => item.roleName || 'base')
      .filter(Boolean),
  )];
  if (roles.length !== 1) {
    throw new Error(`Replay Case mixes target roles (${roles.join(', ')}); one formal replay must target one runtime`);
  }
  const requested = roles[0];
  if (requested === 'base') return undefined;
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(requested)) {
    throw new Error(`Replay Case target role is invalid: ${requested}`);
  }

  const rolesRoot = path.join(root, 'roles');
  if (!fs.existsSync(rolesRoot)) {
    throw new Error(`Replay Case target role is unavailable: ${requested}`);
  }
  const resolvedName = fs.readdirSync(rolesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .find(name => normalizeRoleName(name) === requested);
  if (!resolvedName) {
    throw new Error(`Replay Case target role is unavailable: ${requested}`);
  }

  const roleRoot = resolveExistingInside(root, path.join(rolesRoot, resolvedName), 'Replay target role');
  const config = readObject(
    resolveExistingInside(root, path.join(roleRoot, 'role.json'), 'Replay target role config'),
    'Replay target role config',
  );
  const status = config.status === undefined ? 'active' : String(config.status).trim().toLowerCase();
  if (status !== 'active' && status !== 'candidate') {
    throw new Error(`Replay Case target role is not callable: ${resolvedName} (${status || 'invalid status'})`);
  }
  return resolvedName;
}

function normalizeRoleName(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function removeOwnedReplayRoot(root: string, replayRoot: string): void {
  ensureInside(root, path.resolve(replayRoot), 'Reviewer replay output');
  if (fs.existsSync(replayRoot)) fs.rmSync(replayRoot, { recursive: true, force: true });
}

function resolveExistingInside(root: string, target: string, label: string): string {
  const resolved = path.resolve(target);
  ensureInside(root, resolved, label);
  if (!fs.existsSync(resolved)) throw new Error(`${label} does not exist: ${relativeRef(resolved, root)}`);
  const real = fs.realpathSync(resolved);
  ensureInside(root, real, label);
  return real;
}

function ensureInside(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the workspace`);
  }
}

function readObject(filePath: string, label: string): Record<string, unknown> {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return asObject(value, label);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}

function isEmptyObject(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === 0;
}

function blocked(errorCode: string, reason: string): ToolExecutionOutput {
  return {
    toolContent: [
      'reviewer_trace_replay: status=blocked',
      `error_code=${errorCode}`,
      `blocked_reason=${reason}`,
    ].join('\n'),
    status: 'blocked',
    error_code: errorCode,
    blocked_reason: reason,
    retryable: false,
  };
}

function relativeRef(filePath: string, root: string): string {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function artifact(
  artifactPath: string,
  action: ArtifactManifestItem['action'],
  artifactRole: string,
): ArtifactManifestItem {
  return {
    path: artifactPath,
    type: path.extname(artifactPath).replace(/^\./, '') || 'file',
    action,
    metadata: {
      tool: 'reviewer_trace_replay',
      artifact_role: artifactRole,
    },
  };
}
