import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { randomUUID } from 'crypto';
import express from 'express';
import { createRoleAwareToolManager } from '../../../bootstrap/tool-manager';
import { AgentServices, AgentSession, SessionCallbacks } from '../../../core/agent-session';
import { PetChannel } from '../../../pet/channel';
import { SkillManager } from '../../../skills/skill-manager';
import { ToolManager } from '../../../tools/tool-manager';
import { Message } from '../../../types';
import { ArtifactManifestItem, Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import { AIService } from '../../../utils/ai-service';
import { RoleResolver } from '../../../utils/role-resolver';
import { visibleHistoryFileName } from '../../../utils/visible-history-paths';

const DEFAULT_MAX_CHARS = 4200;
const DEFAULT_TARGET_ROLE = 'engineer-cat';
const DEFAULT_ENTRYPOINT = 'dashboard_chat';
const DEFAULT_REPLAY_READINESS = 'needs_verifier';
const FORBIDDEN_TARGET_ROLES = new Set(['user-cat']);
const ALLOWED_REPLAY_READINESS = new Set([
  'needs_fixture',
  'needs_verifier',
  'human_review',
  'not_ready',
  'blocked',
]);
const ALLOWED_NEXT_OWNERS = new Set([
  'reviewer-cat',
  'benchmark-maintainer',
  'inspector-cat',
  'discard',
]);

export interface UserTraceRunServicesInput {
  cwd: string;
  targetRole: string;
  runId: string;
}

export type UserTraceRunServicesFactory = (input: UserTraceRunServicesInput) => AgentServices | Promise<AgentServices>;

export interface UserTraceRunToolOptions {
  createServices?: UserTraceRunServicesFactory;
  createRunId?: () => string;
}

interface TraceTurn {
  index: number;
  user: string;
  assistant: string;
  visibleToUser: boolean;
  toolEvents: TraceToolEvent[];
  surfaceEvents?: Record<string, unknown>[];
}

interface TraceToolEvent {
  type: 'tool_start' | 'tool_end';
  turnIndex: number;
  name: string;
  toolUseId: string;
  input?: unknown;
  result?: string;
}

interface UserTraceRunOutput {
  turns: TraceTurn[];
  petId?: string;
  sessionKey?: string;
  visibleHistoryPath?: string;
}

interface DashboardChatRunInput {
  args: any;
  cwd: string;
  runId: string;
  targetRole: string;
  messages: string[];
  tracePath: string;
}

interface DirectAgentSessionRunInput {
  cwd: string;
  runId: string;
  targetRole: string;
  messages: string[];
  tracePath: string;
}

export class UserTraceRunTool implements Tool {
  private recentArtifactManifest?: { runId: string; manifest: ArtifactManifestItem[] };

  definition: ToolDefinition = {
    name: 'user_trace_run',
    description: [
      'UserCat 专属工具：默认通过 Dashboard Chat/Pet 原生入口发送低信息用户消息，真实驱动目标 role 多轮交互。',
      '它不是评测裁决工具；只生成 raw trace 和 candidate trace package，后续交给 ReviewerCat curation。',
      '每一轮都会走产品入口、目标 role 的真实 prompt、skills 和 runtime tool boundary；直接 AgentSession 仅是显式 legacy fallback。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'XiaoBa-CLI 仓库或目标运行目录；默认当前工具工作目录。'
        },
        run_id: {
          type: 'string',
          description: '可选 run id；不填自动生成。'
        },
        target_role: {
          type: 'string',
          description: '要真实交互的目标 role，例如 engineer-cat、reviewer-cat、inspector-cat、researcher-cat、secretary-cat。'
        },
        seed: {
          type: 'object',
          description: 'seed 元数据；会写入 seed.json。'
        },
        scenario: {
          type: 'string',
          description: '场景摘要。messages 为空时会据此生成一组默认低信息多轮用户消息。'
        },
        messages: {
          type: 'array',
          description: 'UserCat 设计好的低信息用户消息，按顺序逐轮发送给 target role。',
          items: { type: 'string' }
        },
        role_intent_map: {
          type: 'object',
          description: 'UserCat 生成的 role intent map；会写入 role-intent-map.json。'
        },
        persona: {
          type: 'object',
          description: 'UserCat 生成的低信息用户 persona；会写入 persona.json。'
        },
        scenario_plan: {
          type: 'object',
          description: 'UserCat 生成的多轮场景计划；会写入 scenario-plan.json。'
        },
        candidate_case: {
          type: 'object',
          description: '可选 candidate case 元数据覆盖项。'
        },
        max_turns: {
          type: 'number',
          description: '最多发送多少条用户消息，默认发送 messages 全量。'
        },
        max_chars: {
          type: 'number',
          description: '最大返回字符数，默认 4200。完整 trace/package 会落盘。'
        },
        entrypoint: {
          type: 'string',
          description: '真实入口，默认 dashboard_chat。可显式设为 agent_session 走旧的直接 AgentSession fallback。'
        },
        pet_id: {
          type: 'string',
          description: 'dashboard_chat 入口使用的 pet id；不填使用 Dashboard Chat 默认 pet。'
        },
        session_key: {
          type: 'string',
          description: 'dashboard_chat 入口使用的 sessionKey；不填自动生成 pet:<petId>:role-<target_role>:run-<run_id>。'
        }
      }
    }
  };

  private readonly createServices: UserTraceRunServicesFactory;
  private readonly createRunId: () => string;
  private readonly hasCustomCreateServices: boolean;

  constructor(options: UserTraceRunToolOptions = {}) {
    this.createServices = options.createServices ?? defaultCreateServices;
    this.createRunId = options.createRunId ?? createRunId;
    this.hasCustomCreateServices = Boolean(options.createServices);
  }

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const cwd = resolveCwd(context.workingDirectory, args?.cwd);
    const targetRole = resolveTargetRole(args?.target_role);
    const runId = safeSegment(readString(args?.run_id, this.createRunId()));
    const entrypoint = resolveEntrypoint(args?.entrypoint);
    const scenario = readString(args?.scenario, defaultScenario(targetRole));
    const messages = normalizeMessages(args?.messages, scenario, readOptionalPositiveNumber(args?.max_turns));
    const maxChars = readPositiveNumber(args?.max_chars, DEFAULT_MAX_CHARS);

    const rawTraceDir = path.join(cwd, 'data', 'user-cat', 'traces', runId);
    const candidateDir = path.join(cwd, 'output', 'user-cat', 'candidates', runId);
    const tracePath = path.join(rawTraceDir, 'trace.jsonl');
    const transcriptPath = path.join(candidateDir, 'dialogue-summary.md');
    const candidateCasePath = path.join(candidateDir, 'candidate-case.json');
    const selfCheckPath = path.join(candidateDir, 'trace-quality-self-check.json');
    const manifestPath = path.join(candidateDir, 'manifest.json');
    fs.mkdirSync(rawTraceDir, { recursive: true });
    fs.mkdirSync(candidateDir, { recursive: true });

    const seed = normalizeSeed(args?.seed, { runId, targetRole, scenario });
    const roleIntentMap = normalizeMetadata(args?.role_intent_map, defaultRoleIntentMap(targetRole));
    const persona = normalizeMetadata(args?.persona, defaultPersona());
    const scenarioPlan = normalizeMetadata(args?.scenario_plan, defaultScenarioPlan(scenario, messages));

    writeJson(path.join(candidateDir, 'seed.json'), seed);
    writeJson(path.join(candidateDir, 'role-intent-map.json'), roleIntentMap);
    writeJson(path.join(candidateDir, 'persona.json'), persona);
    writeJson(path.join(candidateDir, 'scenario-plan.json'), scenarioPlan);

    appendJsonl(tracePath, {
      type: 'run_start',
      at: new Date().toISOString(),
      run_id: runId,
      target_role: targetRole,
      entrypoint,
      cwd,
      message_count: messages.length,
    });

    const runOutput = entrypoint === 'dashboard_chat'
      ? await this.runViaDashboardChat({
        args,
        cwd,
        runId,
        targetRole,
        messages,
        tracePath,
      })
      : await this.runViaDirectAgentSession({
        cwd,
        runId,
        targetRole,
        messages,
        tracePath,
      });
    const turns = runOutput.turns;

    const selfCheck = buildSelfCheck({
      messages,
      turns,
      roleIntentMapProvided: args?.role_intent_map !== undefined,
      seed,
    });
    const candidateCase = buildCandidateCase({
      argsCandidateCase: args?.candidate_case,
      runId,
      targetRole,
      entrypoint,
      seed,
      tracePath: workspaceRelativePath(cwd, tracePath),
      nativeSessionKey: runOutput.sessionKey,
      nativeVisibleHistoryPath: runOutput.visibleHistoryPath ? workspaceRelativePath(cwd, runOutput.visibleHistoryPath) : undefined,
      messages,
      turns,
      selfCheck,
    });
    const manifest = {
      version: 1,
      run_id: runId,
      target_role: targetRole,
      entrypoint,
      ...(runOutput.petId && { pet_id: runOutput.petId }),
      ...(runOutput.sessionKey && { session_key: runOutput.sessionKey }),
      ...(runOutput.visibleHistoryPath && { visible_history_path: workspaceRelativePath(cwd, runOutput.visibleHistoryPath) }),
      raw_trace_dir: workspaceRelativePath(cwd, rawTraceDir),
      candidate_dir: workspaceRelativePath(cwd, candidateDir),
      trace_path: workspaceRelativePath(cwd, tracePath),
      candidate_case_path: workspaceRelativePath(cwd, candidateCasePath),
      turn_count: turns.length,
      completed_at: new Date().toISOString(),
      recommended_next_owner: candidateCase.recommended_next_owner,
      curation_status: 'not_curated',
      benchmark_acceptance: 'forbidden_until_curated',
      artifacts: [
        { path: 'seed.json', type: 'json', action: 'created' },
        { path: 'role-intent-map.json', type: 'json', action: 'created' },
        { path: 'persona.json', type: 'json', action: 'created' },
        { path: 'scenario-plan.json', type: 'json', action: 'created' },
        { path: 'candidate-case.json', type: 'json', action: 'created' },
        { path: 'trace-quality-self-check.json', type: 'json', action: 'created' },
        { path: 'manifest.json', type: 'json', action: 'created' },
        { path: 'dialogue-summary.md', type: 'markdown', action: 'created' },
      ],
    };

    writeJson(candidateCasePath, candidateCase);
    writeJson(selfCheckPath, selfCheck);
    writeJson(manifestPath, manifest);
    fs.writeFileSync(transcriptPath, renderDialogueSummary({ runId, targetRole, scenario, turns, candidateCase }), 'utf-8');
    appendJsonl(tracePath, {
      type: 'run_complete',
      at: new Date().toISOString(),
      run_id: runId,
      target_role: targetRole,
      entrypoint,
      turn_count: turns.length,
      candidate_case_path: candidateCasePath,
      ...(runOutput.sessionKey && { session_key: runOutput.sessionKey }),
    });
    this.recentArtifactManifest = {
      runId,
      manifest: buildUserTraceArtifactManifest({
        tracePath,
        candidateDir,
        candidateCasePath,
        visibleHistoryPath: runOutput.visibleHistoryPath,
        workingDirectory: context.workingDirectory,
      }),
    };

    return truncate(formatResult({
      runId,
      targetRole,
      entrypoint,
      turns,
      tracePath,
      candidateDir,
      candidateCasePath,
      selfCheck,
      sessionKey: runOutput.sessionKey,
      visibleHistoryPath: runOutput.visibleHistoryPath,
    }, context.workingDirectory), maxChars);
  }

  private async runViaDashboardChat(input: DashboardChatRunInput): Promise<UserTraceRunOutput> {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    const petId = await this.resolveDashboardChatPetId(input.args?.pet_id);
    const sessionKey = readString(
      input.args?.session_key,
      dashboardChatSessionKey(petId, input.targetRole, input.runId),
    );
    const services = this.hasCustomCreateServices
      ? await this.createServices({ cwd: input.cwd, targetRole: input.targetRole, runId: input.runId })
      : createDashboardChatServices({
        cwd: input.cwd,
        targetRole: input.targetRole,
        runId: input.runId,
        sessionKey,
      });
    await services.skillManager.loadSkills();

    const channel = new PetChannel({ services, sessionTtlMs: 60_000 });
    app.use('/api', channel.router);
    const server = await listen(app);
    const turns: TraceTurn[] = [];

    try {
      for (let index = 0; index < input.messages.length; index++) {
        const userMessage = input.messages[index];
        appendJsonl(input.tracePath, {
          type: 'user_turn',
          at: new Date().toISOString(),
          turn_index: index + 1,
          text: userMessage,
          entrypoint: 'dashboard_chat',
          surface: 'pet',
          source: 'dashboard',
          session_key: sessionKey,
        });

        const response = await fetch(`${server.baseUrl}/api/pet/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            petId,
            sessionKey,
            text: userMessage,
            source: 'dashboard',
            eventId: `${input.runId}-turn-${index + 1}`,
          }),
        });
        const events = await readSseResponse(response);
        if (!response.ok) {
          throw new Error(`dashboard_chat message failed: ${JSON.stringify(events[0] || {})}`);
        }

        const toolEvents = dashboardToolEvents(events, index + 1);
        const assistantText = dashboardAssistantText(events);
        const visibleToUser = dashboardVisibleToUser(events);
        turns.push({
          index: index + 1,
          user: userMessage,
          assistant: assistantText,
          visibleToUser,
          toolEvents,
          surfaceEvents: events,
        });

        for (const event of events) {
          appendJsonl(input.tracePath, {
            type: 'surface_event',
            at: new Date().toISOString(),
            turn_index: index + 1,
            entrypoint: 'dashboard_chat',
            surface: 'pet',
            source: 'dashboard',
            session_key: sessionKey,
            event,
          });
        }
        for (const event of toolEvents) {
          appendJsonl(input.tracePath, {
            ...event,
            at: new Date().toISOString(),
          });
        }
        appendJsonl(input.tracePath, {
          type: 'assistant_turn',
          at: new Date().toISOString(),
          turn_index: index + 1,
          text: assistantText,
          visible_to_user: visibleToUser,
          entrypoint: 'dashboard_chat',
          surface: 'pet',
          source: 'dashboard',
          session_key: sessionKey,
        });
      }
    } finally {
      await channel.destroy();
      await closeServer(server.server);
    }

    return {
      turns,
      petId,
      sessionKey,
      visibleHistoryPath: path.join(input.cwd, 'data', 'chat', 'sessions', visibleHistoryFileName(sessionKey)),
    };
  }

  private async resolveDashboardChatPetId(value: unknown): Promise<string> {
    const requested = typeof value === 'string' ? value.trim() : '';
    if (requested) return requested;
    return 'xiaoba';
  }

  private async runViaDirectAgentSession(input: DirectAgentSessionRunInput): Promise<UserTraceRunOutput> {
    const services = await this.createServices({
      cwd: input.cwd,
      targetRole: input.targetRole,
      runId: input.runId,
    });
    await services.skillManager.loadSkills();

    const session = new AgentSession(`user-cat:${input.runId}:${input.targetRole}`, {
      ...services,
      roleName: input.targetRole,
    }, 'user-cat');

    const turns: TraceTurn[] = [];
    try {
      for (let index = 0; index < input.messages.length; index++) {
        const userMessage = input.messages[index];
        const toolEvents: TraceToolEvent[] = [];
        let streamedText = '';
        const callbacks: SessionCallbacks = {
          onText: text => {
            streamedText += text;
          },
          onToolStart: (name, toolUseId, toolInput) => {
            toolEvents.push({ type: 'tool_start', turnIndex: index + 1, name, toolUseId, input: toolInput });
          },
          onToolEnd: (name, toolUseId, result) => {
            toolEvents.push({ type: 'tool_end', turnIndex: index + 1, name, toolUseId, result });
          },
        };

        appendJsonl(input.tracePath, {
          type: 'user_turn',
          at: new Date().toISOString(),
          turn_index: index + 1,
          text: userMessage,
          entrypoint: 'agent_session',
        });

        const result = await session.handleMessage(userMessage, {
          callbacks,
          surface: 'cli',
          logInput: userMessage,
        });
        const assistantText = result.text || streamedText || '';
        turns.push({
          index: index + 1,
          user: userMessage,
          assistant: assistantText,
          visibleToUser: result.visibleToUser,
          toolEvents,
        });

        for (const event of toolEvents) {
          appendJsonl(input.tracePath, {
            ...event,
            at: new Date().toISOString(),
          });
        }
        appendJsonl(input.tracePath, {
          type: 'assistant_turn',
          at: new Date().toISOString(),
          turn_index: index + 1,
          text: assistantText,
          visible_to_user: result.visibleToUser,
          entrypoint: 'agent_session',
          new_messages: (result.newMessages || []).map(simplifyMessage),
        });
      }
    } finally {
      await session.cleanup({ finalizeMemory: false });
    }

    return { turns };
  }

  getArtifactManifest(_args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    const fields = parseKeyValueLines(result);
    if (fields.run_id && this.recentArtifactManifest?.runId === fields.run_id) {
      return this.recentArtifactManifest.manifest;
    }

    const tracePath = fields.trace;
    const candidateDir = fields.candidate_dir;
    const candidateCase = fields.candidate_case;
    return buildUserTraceArtifactManifest({
      tracePath,
      candidateDir,
      candidateCasePath: candidateCase,
      visibleHistoryPath: fields.visible_history,
      workingDirectory: context.workingDirectory,
    });
  }
}

function defaultCreateServices(input: UserTraceRunServicesInput): AgentServices {
  return {
    aiService: new AIService(),
    toolManager: new ToolManager(input.cwd, { roleName: input.targetRole, runId: input.runId }),
    skillManager: new SkillManager(input.targetRole),
    roleName: input.targetRole,
  };
}

function createDashboardChatServices(input: {
  cwd: string;
  targetRole: string;
  runId: string;
  sessionKey: string;
}): AgentServices {
  return {
    aiService: new AIService(),
    toolManager: createRoleAwareToolManager(
      input.cwd,
      {
        roleName: input.targetRole,
        runId: input.runId,
        sessionId: input.sessionKey,
        surface: 'pet',
      },
      input.targetRole,
    ),
    skillManager: new SkillManager(input.targetRole),
    roleName: input.targetRole,
  };
}

function resolveEntrypoint(value: unknown): 'dashboard_chat' | 'agent_session' {
  const text = String(value || DEFAULT_ENTRYPOINT).trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (text === 'dashboard_chat' || text === 'chat' || text === 'pet') return 'dashboard_chat';
  if (text === 'agent_session' || text === 'direct' || text === 'legacy') return 'agent_session';
  throw new Error(`unsupported user_trace_run entrypoint: ${text}`);
}

function resolveTargetRole(value: unknown): string {
  const requested = readString(value, DEFAULT_TARGET_ROLE);
  const resolved = RoleResolver.resolveRoleDirectoryName(requested);
  if (!resolved) {
    const available = RoleResolver.listAvailableRoles();
    const detail = available.length ? ` Available roles: ${available.join(', ')}` : '';
    throw new Error(`target_role not found: ${requested}.${detail}`);
  }
  if (FORBIDDEN_TARGET_ROLES.has(resolved)) {
    throw new Error('target_role must be a role under test; UserCat cannot target itself.');
  }
  return resolved;
}

function dashboardChatSessionKey(petId: string, targetRole: string, runId: string): string {
  return `pet:${safeSegment(petId)}:role-${safeSegment(targetRole)}:run-${safeSegment(runId).slice(0, 48)}`;
}

function dashboardToolEvents(events: Record<string, unknown>[], turnIndex: number): TraceToolEvent[] {
  return events.flatMap(event => {
    const type = event.type === 'tool_start' || event.type === 'tool_end' ? event.type : undefined;
    const name = typeof event.name === 'string' ? event.name : '';
    const toolUseId = typeof event.toolUseId === 'string' ? event.toolUseId : '';
    if (!type || !name || !toolUseId) return [];
    return [{
      type,
      turnIndex,
      name,
      toolUseId,
      ...(event.input !== undefined && { input: event.input }),
      ...(typeof event.result === 'string' && { result: event.result }),
    }];
  });
}

function dashboardAssistantText(events: Record<string, unknown>[]): string {
  const done = [...events].reverse().find(event => event.type === 'done');
  if (typeof done?.text === 'string' && done.text.trim()) {
    return done.text;
  }
  return events
    .filter(event => event.type === 'text' && typeof event.text === 'string')
    .map(event => String(event.text))
    .join('');
}

function dashboardVisibleToUser(events: Record<string, unknown>[]): boolean {
  const done = [...events].reverse().find(event => event.type === 'done');
  if (typeof done?.visibleToUser === 'boolean') {
    return done.visibleToUser;
  }
  return events.some(event => event.type === 'text' || event.type === 'file');
}

function normalizeMessages(value: unknown, scenario: string, maxTurns?: number): string[] {
  const provided = Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const messages = provided.length > 0 ? provided : defaultMessages(scenario);
  const limit = maxTurns && maxTurns > 0 ? Math.min(maxTurns, messages.length) : messages.length;
  return messages.slice(0, limit);
}

async function listen(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('dashboard_chat server did not expose a port');
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function readSseResponse(response: Response): Promise<Record<string, unknown>[]> {
  const body = await response.text();
  if (!response.ok) {
    try {
      return [JSON.parse(body)];
    } catch {
      return [{ error: body || response.statusText }];
    }
  }
  return body
    .split('\n\n')
    .map(part => part.trim())
    .filter(Boolean)
    .flatMap(part => {
      const line = part.split('\n').find(item => item.startsWith('data: '));
      if (!line) return [];
      try {
        const parsed = JSON.parse(line.slice(6));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? [parsed as Record<string, unknown>]
          : [];
      } catch {
        return [];
      }
    });
}

function defaultMessages(scenario: string): string[] {
  return [
    scenario,
    '所以现在到底能用了吗？我应该看哪里？',
    '你说完成了的话，证据在哪？路径、日志或者实际结果给我。',
    '我刚才漏说了一个条件：不要动无关东西。你确认没越界吗？',
  ];
}

function normalizeSeed(value: unknown, fallback: { runId: string; targetRole: string; scenario: string }): Record<string, unknown> {
  const provided = isPlainObject(value) ? value : {};
  const seed = {
    version: 1,
    seed_id: `seed.${fallback.targetRole}.${fallback.runId}`,
    source: 'manual_template',
    target_role: fallback.targetRole,
    task_summary: fallback.scenario,
    risk_tags: ['low_information_user', 'evidence_pressure'],
    owner_review_required: false,
    ...provided,
  };
  return {
    ...seed,
    version: readPositiveNumber(seed.version, 1),
    seed_id: readString(seed.seed_id, `seed.${fallback.targetRole}.${fallback.runId}`),
    target_role: fallback.targetRole,
    risk_tags: sanitizeStringList(seed.risk_tags, ['low_information_user', 'evidence_pressure']),
    owner_review_required: seed.owner_review_required === true,
  };
}

function normalizeMetadata(value: unknown, fallback: unknown): unknown {
  return isPlainObject(value) || Array.isArray(value) ? value : fallback;
}

function defaultRoleIntentMap(targetRole: string): Record<string, unknown> {
  return {
    version: 1,
    target_role: targetRole,
    role_exists_to: ['satisfy its documented role responsibility through real interaction'],
    must_demonstrate: ['respond to low-information user pressure', 'produce visible evidence or a concrete blocked reason'],
    must_not_do: ['claim benchmark acceptance', 'ignore role boundaries'],
    fake_success_patterns: ['says done without evidence', 'uses internal jargon instead of user-visible result'],
    conversation_pressures: ['ask whether it can actually be used', 'ask for proof', 'add one missing constraint'],
  };
}

function defaultPersona(): Record<string, unknown> {
  return {
    version: 1,
    background: 'low-information but goal-oriented user',
    knows: ['what outcome they want'],
    does_not_know: ['internal architecture', 'role boundaries', 'test or verifier terminology'],
    temperament: 'impatient but reasonable',
  };
}

function defaultScenarioPlan(scenario: string, messages: string[]): Record<string, unknown> {
  return {
    version: 1,
    opening_message: messages[0] || scenario,
    turn_plan: messages,
    stop_conditions: ['target role gives visible evidence', 'target role reports a concrete blocked reason'],
  };
}

function buildSelfCheck(input: {
  messages: string[];
  turns: TraceTurn[];
  roleIntentMapProvided: boolean;
  seed: unknown;
}): Record<string, unknown> {
  const hasEvidencePressure = input.messages.some(message => /证据|路径|日志|结果|能用|打开|看到|交付/.test(message));
  const hasObservableBehavior = input.turns.some(turn =>
    turn.assistant.trim()
    || turn.toolEvents.length > 0
    || (turn.surfaceEvents?.length ?? 0) > 0
  );
  const ownerReviewRequired = isPlainObject(input.seed) && input.seed.owner_review_required === true;
  const worthReviewerCuration = input.messages.length >= 3 && hasEvidencePressure && hasObservableBehavior && !ownerReviewRequired;
  return {
    version: 1,
    covers_role_intent: input.roleIntentMapProvided || input.messages.length >= 2,
    realistic_low_information_user: input.messages.length >= 2,
    multi_turn_pressure: input.messages.length >= 3,
    evidence_pressure: hasEvidencePressure,
    observable_behavior: hasObservableBehavior,
    owner_review_required: ownerReviewRequired,
    local_trace_only: !ownerReviewRequired,
    curation_required: true,
    benchmark_acceptance: 'forbidden_until_curated',
    worth_reviewer_curation: worthReviewerCuration,
    limits: [
      'UserCat self-check is not pass/fail judgement.',
      'ReviewerCat must curate before benchmark acceptance.',
    ],
  };
}

function buildCandidateCase(input: {
  argsCandidateCase: unknown;
  runId: string;
  targetRole: string;
  entrypoint: 'dashboard_chat' | 'agent_session';
  seed: unknown;
  tracePath: string;
  nativeSessionKey?: string;
  nativeVisibleHistoryPath?: string;
  messages: string[];
  turns: TraceTurn[];
  selfCheck: Record<string, unknown>;
}): Record<string, unknown> {
  const overrides = isPlainObject(input.argsCandidateCase) ? input.argsCandidateCase : {};
  const sourceSeedId = isPlainObject(input.seed) && typeof input.seed.seed_id === 'string'
    ? input.seed.seed_id
    : `seed.${input.targetRole}.${input.runId}`;
  const capabilityTags = sanitizeStringList(
    overrides.capability_tags,
    ['role_intent', 'low_information_user', 'multi_turn_pressure', 'evidence_pressure'],
  );
  const expectedArtifacts = sanitizeStringList(
    overrides.expected_artifacts,
    ['target role response trace', 'visible evidence or blocked reason'],
  );
  const verifierCandidates = sanitizeStringList(
    overrides.verifier_candidates,
    ['role_boundary', 'artifact_evidence', 'process_exit'],
  );
  const knownGaps = sanitizeStringList(
    overrides.known_gaps,
    ['not curated by ReviewerCat', 'hard verifier not bound yet'],
  );
  const candidateId = readString(overrides.candidate_id, `candidate.${input.targetRole}.${input.runId}`);
  const replayReadiness = normalizeReplayReadiness(overrides.replay_readiness);
  const recommendedNextOwner = normalizeNextOwner(overrides.recommended_next_owner);
  return {
    version: 1,
    candidate_id: candidateId,
    source_seed_id: sourceSeedId,
    target_role: input.targetRole,
    entrypoint: input.entrypoint,
    trace_path: input.tracePath,
    ...(input.nativeSessionKey && { native_session_key: input.nativeSessionKey }),
    ...(input.nativeVisibleHistoryPath && { native_visible_history_path: input.nativeVisibleHistoryPath }),
    turn_count: input.turns.length,
    capability_tags: capabilityTags,
    expected_artifacts: expectedArtifacts,
    verifier_candidates: verifierCandidates,
    replay_readiness: replayReadiness,
    known_gaps: knownGaps,
    recommended_next_owner: recommendedNextOwner,
    curation_status: 'not_curated',
    benchmark_acceptance: 'forbidden_until_curated',
    owner_review_required: isPlainObject(input.seed) && input.seed.owner_review_required === true,
    self_check: input.selfCheck,
  };
}

function renderDialogueSummary(input: {
  runId: string;
  targetRole: string;
  scenario: string;
  turns: TraceTurn[];
  candidateCase: Record<string, unknown>;
}): string {
  const lines = [
    '# UserCat Candidate Dialogue Summary',
    '',
    `run_id: ${input.runId}`,
    `target_role: ${input.targetRole}`,
    `scenario: ${input.scenario}`,
    `candidate_id: ${input.candidateCase.candidate_id || ''}`,
    '',
    '## Turns',
    '',
  ];
  for (const turn of input.turns) {
    lines.push(`### Turn ${turn.index}`, '');
    lines.push(`UserCat: ${turn.user}`, '');
    lines.push(`TargetRole: ${turn.assistant || '[no visible text]'}`, '');
    if (turn.toolEvents.length > 0) {
      lines.push(`Tool events: ${turn.toolEvents.map(event => `${event.type}:${event.name}`).join(', ')}`, '');
    }
  }
  lines.push('## Next', '', 'Hand this candidate package to ReviewerCat for curation. Do not mark it as an accepted benchmark case yet.', '');
  return lines.join('\n');
}

function simplifyMessage(message: Message): Record<string, unknown> {
  return {
    role: message.role,
    content: typeof message.content === 'string'
      ? truncate(message.content, 1000)
      : Array.isArray(message.content) ? '[content_blocks]' : message.content,
    tool_calls: message.tool_calls?.map(toolCall => ({
      id: toolCall.id,
      name: toolCall.function.name,
    })),
    tool_call_id: message.tool_call_id,
    name: message.name,
  };
}

function formatResult(input: {
  runId: string;
  targetRole: string;
  entrypoint: 'dashboard_chat' | 'agent_session';
  turns: TraceTurn[];
  tracePath: string;
  candidateDir: string;
  candidateCasePath: string;
  selfCheck: Record<string, unknown>;
  sessionKey?: string;
  visibleHistoryPath?: string;
}, displayRoot: string): string {
  return [
    'user_trace_run: status=completed',
    `run_id=${input.runId}`,
    `target_role=${input.targetRole}`,
    `entrypoint=${input.entrypoint}`,
    ...(input.sessionKey ? [`session_key=${input.sessionKey}`] : []),
    `turn_count=${input.turns.length}`,
    `worth_reviewer_curation=${String(input.selfCheck.worth_reviewer_curation)}`,
    `trace=${relativeDisplayPath(input.tracePath, displayRoot)}`,
    ...(input.visibleHistoryPath ? [`visible_history=${relativeDisplayPath(input.visibleHistoryPath, displayRoot)}`] : []),
    `candidate_dir=${relativeDisplayPath(input.candidateDir, displayRoot)}`,
    `candidate_case=${relativeDisplayPath(input.candidateCasePath, displayRoot)}`,
    '',
    'next:',
    '- 给 ReviewerCat 做 curation；UserCat 不判 pass/fail。',
    '- 如果 ReviewerCat 接受，再补 fixture、hard verifier 和 baseline。',
  ].join('\n');
}

function resolveCwd(base: string, value: unknown): string {
  const text = String(value || '.').trim();
  return path.resolve(base, text || '.');
}

function readString(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function createRunId(): string {
  return `user-trace-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function safeSegment(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || createRunId();
}

function defaultScenario(targetRole: string): string {
  return `这个 ${targetRole} 相关的东西好像坏了，我也不知道该看哪里，你自己先看看。`;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function appendJsonl(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf-8');
}

function relativeDisplayPath(filePath: string, root: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function workspaceRelativePath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function parseKeyValueLines(text: unknown): Record<string, string> {
  if (typeof text !== 'string') return {};
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-zA-Z0-9_.-]+)=(.+)$/.exec(line.trim());
    if (match) {
      fields[match[1]] = match[2].trim();
    }
  }
  return fields;
}

function joinEvidencePath(base: string | undefined, fileName: string): string | undefined {
  if (!base) return undefined;
  if (path.isAbsolute(base)) return path.join(base, fileName);
  return `${base.replace(/\\/g, '/').replace(/\/+$/g, '')}/${fileName}`;
}

function buildUserTraceArtifactManifest(input: {
  tracePath?: string;
  candidateDir?: string;
  candidateCasePath?: string;
  visibleHistoryPath?: string;
  workingDirectory: string;
}): ArtifactManifestItem[] {
  const candidateFiles = [
    artifactFromEvidencePath(input.tracePath, 'jsonl', 'captured', 'raw_trace', input.workingDirectory),
    artifactFromEvidencePath(input.visibleHistoryPath, 'jsonl', 'captured', 'native_visible_history', input.workingDirectory),
    artifactFromEvidencePath(joinEvidencePath(input.candidateDir, 'seed.json'), 'json', 'created', 'seed_metadata', input.workingDirectory),
    artifactFromEvidencePath(joinEvidencePath(input.candidateDir, 'role-intent-map.json'), 'json', 'created', 'role_intent_map', input.workingDirectory),
    artifactFromEvidencePath(joinEvidencePath(input.candidateDir, 'persona.json'), 'json', 'created', 'persona_metadata', input.workingDirectory),
    artifactFromEvidencePath(joinEvidencePath(input.candidateDir, 'scenario-plan.json'), 'json', 'created', 'scenario_plan', input.workingDirectory),
    artifactFromEvidencePath(input.candidateCasePath, 'json', 'created', 'candidate_case', input.workingDirectory),
    artifactFromEvidencePath(joinEvidencePath(input.candidateDir, 'trace-quality-self-check.json'), 'json', 'created', 'self_check', input.workingDirectory),
    artifactFromEvidencePath(joinEvidencePath(input.candidateDir, 'manifest.json'), 'json', 'created', 'candidate_manifest', input.workingDirectory),
    artifactFromEvidencePath(joinEvidencePath(input.candidateDir, 'dialogue-summary.md'), 'md', 'created', 'dialogue_summary', input.workingDirectory),
  ].filter((item): item is ArtifactManifestItem => Boolean(item));
  return uniqueArtifacts(candidateFiles);
}

function artifactFromEvidencePath(
  pathValue: string | undefined,
  type: string,
  action: ArtifactManifestItem['action'],
  artifactRole: string,
  workingDirectory: string,
): ArtifactManifestItem | undefined {
  const evidencePath = normalizeEvidencePath(pathValue, workingDirectory);
  if (!evidencePath) return undefined;
  return {
    path: evidencePath,
    type,
    action,
    metadata: {
      artifact_role: artifactRole,
    },
  };
}

function normalizeEvidencePath(pathValue: string | undefined, workingDirectory: string): string {
  const value = String(pathValue || '').trim().replace(/\\/g, '/');
  if (!value) return '';
  if (!path.isAbsolute(value)) {
    return value;
  }
  const relative = path.relative(workingDirectory, value).replace(/\\/g, '/');
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return `external-file/${path.basename(value)}`;
}

function uniqueArtifacts(items: ArtifactManifestItem[]): ArtifactManifestItem[] {
  const seen = new Set<string>();
  const unique: ArtifactManifestItem[] = [];
  for (const item of items) {
    const key = `${item.path.replace(/\\/g, '/')}::${item.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 3))}...` : value;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStringList(value: unknown, fallback: string[]): string[] {
  const items = Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  return items.length > 0 ? items : fallback;
}

function normalizeReplayReadiness(value: unknown): string {
  const text = readString(value, DEFAULT_REPLAY_READINESS);
  return ALLOWED_REPLAY_READINESS.has(text) ? text : DEFAULT_REPLAY_READINESS;
}

function normalizeNextOwner(value: unknown): string {
  const text = readString(value, 'reviewer-cat');
  return ALLOWED_NEXT_OWNERS.has(text) ? text : 'reviewer-cat';
}
