import { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AIService } from '../utils/ai-service';
import { AgentSession, AgentServices, BUSY_MESSAGE, ERROR_MESSAGE, SessionCallbacks } from '../core/agent-session';
import { createRoleAwareToolManager } from '../bootstrap/tool-manager';
import { SkillManager } from '../skills/skill-manager';
import { RoleResolver } from '../utils/role-resolver';
import { ChannelCallbacks, Tool, ToolDefinition, ToolExecutionContext } from '../types/tool';
import { Logger } from '../utils/logger';

type RoomAgentStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped';

interface RoomAgentInfo {
  id: string;
  roleName: string;
  displayName: string;
  description: string;
  petId: string;
  spriteUrl: string;
  cwd: string;
  status: RoomAgentStatus;
  createdAt: number;
  lastActiveAt: number;
  lastMessage?: string;
}

interface RoomEvent {
  type: string;
  [key: string]: unknown;
}

interface RoomPeerInfo {
  id: string;
  roleName: string;
  displayName: string;
  status: RoomAgentStatus;
}

interface RoomPrivateMessageReceipt {
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  toName: string;
}

interface RoomMessenger {
  listPeers(fromAgentId: string): RoomPeerInfo[];
  sendPrivateMessage(fromAgentId: string, to: string, text: string): Promise<RoomPrivateMessageReceipt>;
}

interface RoomEventSink {
  event(event: RoomEvent): void;
  state(state: string, reason: string): void;
  text(text: string): void;
  done(text: string, visibleToUser: boolean): void;
}

const ROOM_ROLE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

export function createRoomRouter(): Router {
  const channel = new RoomChannel();
  return channel.router;
}

class RoomAgent {
  readonly id: string;
  readonly session: AgentSession;
  readonly services: AgentServices;
  status: RoomAgentStatus = 'idle';
  createdAt = Date.now();
  lastActiveAt = Date.now();
  lastMessage = '';
  queue: Promise<void> = Promise.resolve();

  constructor(
    readonly infoBase: Omit<RoomAgentInfo, 'status' | 'createdAt' | 'lastActiveAt' | 'lastMessage'>,
    private readonly messenger: RoomMessenger,
  ) {
    this.id = infoBase.id;
    const skillManager = new SkillManager(infoBase.roleName);
    const toolManager = createRoleAwareToolManager(
      infoBase.cwd,
      {
        sessionId: `pet:room:${infoBase.id}`,
        surface: 'pet',
        permissionProfile: 'strict',
        roleName: infoBase.roleName,
      },
      infoBase.roleName,
    );
    toolManager.registerTool(new RoomMessageTool(infoBase.id, messenger));
    this.services = {
      aiService: new AIService(),
      toolManager,
      skillManager,
      roleName: infoBase.roleName,
    };
    this.session = new AgentSession(`pet:room:${infoBase.id}`, this.services, 'pet');
    this.session.runWithLogContext(() => Logger.info(`新建会话: ${this.session.key}`));
  }

  toInfo(): RoomAgentInfo {
    return {
      ...this.infoBase,
      status: this.status,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      lastMessage: this.lastMessage || undefined,
    };
  }
}

export class RoomChannel {
  readonly router = Router();
  private readonly agents = new Map<string, RoomAgent>();
  private readonly events = new RoomEventHub();

  constructor() {
    this.mountRoutes();
  }

  private mountRoutes(): void {
    this.router.get('/room/roles', (_req, res) => {
      res.json({
        roles: this.listRoleOptions(),
        cwd: process.cwd(),
      });
    });

    this.router.get('/room/agents', (_req, res) => {
      res.json({
        agents: Array.from(this.agents.values()).map(agent => agent.toInfo()),
      });
    });

    this.router.post('/room/agents', async (req, res) => {
      try {
        const agent = await this.createAgent(req.body?.roleName, req.body?.cwd);
        res.json({ ok: true, agent: agent.toInfo() });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    this.router.delete('/room/agents/:agentId', (req, res) => {
      const agent = this.agents.get(req.params.agentId);
      if (!agent) {
        res.status(404).json({ error: 'agent not found' });
        return;
      }
      agent.status = 'stopped';
      agent.session.requestInterrupt();
      this.agents.delete(agent.id);
      this.events.publish(agent.id, { type: 'state', state: 'failed', reason: 'removed' });
      res.json({ ok: true });
    });

    this.router.post('/room/agents/:agentId/interrupt', (req, res) => {
      const agent = this.agents.get(req.params.agentId);
      if (!agent) {
        res.status(404).json({ error: 'agent not found' });
        return;
      }
      agent.session.requestInterrupt();
      this.events.publish(agent.id, { type: 'state', state: 'failed', reason: 'interrupt_requested' });
      res.json({ ok: true });
    });

    this.router.post('/room/agents/:agentId/message', async (req, res) => {
      await this.handleAgentMessage(req.params.agentId, req.body, res);
    });

    this.router.post('/room/messages', async (req, res) => {
      try {
        const fromAgentId = typeof req.body?.fromAgentId === 'string' ? req.body.fromAgentId.trim() : '';
        const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        const receipt = await this.sendPrivateMessage(fromAgentId, to, text);
        res.json({ ok: true, ...receipt });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    this.router.get('/room/events', (req, res) => {
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : '';
      if (!agentId || !this.agents.has(agentId)) {
        res.status(404).json({ error: 'agent not found' });
        return;
      }
      this.events.subscribe(agentId, res, { replay: req.query.replay === '1' });
    });
  }

  private async createAgent(inputRoleName: unknown, inputCwd: unknown): Promise<RoomAgent> {
    const requested = typeof inputRoleName === 'string' ? inputRoleName.trim() : '';
    if (!requested) {
      throw new Error('roleName required');
    }
    const resolved = RoleResolver.resolveRoleDirectoryName(requested);
    if (!resolved || !ROOM_ROLE_PATTERN.test(resolved)) {
      throw new Error(`unknown role: ${requested}`);
    }

    const config = RoleResolver.getRoleConfig(resolved);
    const petId = this.resolveRolePetId(resolved);
    const cwd = typeof inputCwd === 'string' && inputCwd.trim()
      ? path.resolve(inputCwd.trim())
      : process.cwd();
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`invalid cwd: ${cwd}`);
    }

    const agent = new RoomAgent({
      id: `room-${resolved}-${randomUUID().slice(0, 8)}`,
      roleName: resolved,
      displayName: config?.displayName || resolved,
      description: config?.description || '',
      petId,
      spriteUrl: `/api/pet/pets/${encodeURIComponent(petId)}/spritesheet`,
      cwd,
    }, this.createMessenger());
    await agent.services.skillManager.loadSkills();
    this.agents.set(agent.id, agent);
    this.events.publish(agent.id, { type: 'state', state: 'waving', reason: 'created' });
    return agent;
  }

  private createMessenger(): RoomMessenger {
    return {
      listPeers: fromAgentId => this.listPeers(fromAgentId),
      sendPrivateMessage: (fromAgentId, to, text) => this.sendPrivateMessage(fromAgentId, to, text),
    };
  }

  private async handleAgentMessage(agentId: string, body: any, res: Response): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text required' });
      return;
    }

    const stream = new RoomEventStream(res);
    stream.setFanout(event => this.events.publish(agent.id, event));
    stream.open();
    stream.event({ type: 'user_message', text, source: 'room', sessionKey: agent.session.key });
    agent.session.runWithLogContext(() => Logger.info(`[${agent.session.key}] 收到 room 消息: ${text.slice(0, 120)}`));

    await this.enqueueAgentMessage(agent, text, stream);
  }

  private async enqueueAgentMessage(agent: RoomAgent, text: string, sink: RoomEventSink): Promise<void> {
    agent.queue = agent.queue.catch(() => undefined).then(async () => {
      agent.status = 'running';
      agent.lastActiveAt = Date.now();
      sink.state('waiting', 'queued');

      try {
        const callbacks = this.buildCallbacks(sink);
        const channel = this.buildChannel(agent, sink);
        const roomPrompt = this.buildRoomPrompt(agent, text);
        sink.state('running', 'processing');
        const result = await agent.session.handleMessage(roomPrompt, { callbacks, channel, logInput: text });

        if (result.text === BUSY_MESSAGE || result.text === ERROR_MESSAGE) {
          sink.event({ type: 'error', message: result.text });
          agent.status = 'failed';
          agent.lastMessage = result.text || '';
          sink.state('failed', result.text === BUSY_MESSAGE ? 'busy' : 'error');
          sink.done('', false);
          return;
        }

        agent.status = 'done';
        agent.lastMessage = result.text || '';
        sink.state('waving', 'done');
        sink.done(result.text || '', result.visibleToUser);
      } catch (err: any) {
        agent.status = 'failed';
        agent.lastMessage = err.message || String(err);
        agent.session.runWithLogContext(() => Logger.error(`[room:${agent.id}] message failed: ${agent.lastMessage}`));
        sink.state('failed', 'error');
        sink.event({ type: 'error', message: agent.lastMessage });
        sink.done('', false);
      } finally {
        agent.lastActiveAt = Date.now();
      }
    });

    await agent.queue;
  }

  private async sendPrivateMessage(fromAgentId: string, to: string, text: string): Promise<RoomPrivateMessageReceipt> {
    const from = this.agents.get(fromAgentId);
    if (!from) {
      throw new Error('fromAgentId not found');
    }
    if (!text.trim()) {
      throw new Error('text required');
    }
    const target = this.resolveAgentReference(to, fromAgentId);
    if (!target) {
      throw new Error(`target agent not found or ambiguous: ${to}`);
    }

    const messageId = `room-msg-${randomUUID().slice(0, 8)}`;
    const payload = {
      type: 'room_message',
      messageId,
      fromAgentId: from.id,
      fromName: from.infoBase.displayName,
      fromRoleName: from.infoBase.roleName,
      toAgentId: target.id,
      toName: target.infoBase.displayName,
      toRoleName: target.infoBase.roleName,
      text: text.trim(),
    };

    this.events.publish(from.id, { ...payload, direction: 'outbound' });
    this.events.publish(target.id, { ...payload, direction: 'inbound' });

    const incomingText = `Private message from ${from.infoBase.displayName} (${from.infoBase.roleName}, ${from.id}):\n${text.trim()}`;
    const sink = new RoomLocalEventSink(event => this.events.publish(target.id, event));
    sink.event({
      type: 'user_message',
      source: 'room_dm',
      text: incomingText,
      fromAgentId: from.id,
      fromName: from.infoBase.displayName,
      messageId,
      sessionKey: target.session.key,
    });

    void this.enqueueAgentMessage(target, incomingText, sink).catch(err => {
      target.session.runWithLogContext(() => Logger.error(`[room:${target.id}] private message failed: ${err.message || err}`));
    });

    return {
      messageId,
      fromAgentId: from.id,
      toAgentId: target.id,
      toName: target.infoBase.displayName,
    };
  }

  private resolveAgentReference(reference: string, fromAgentId?: string): RoomAgent | undefined {
    const normalized = reference.trim().toLowerCase();
    if (!normalized) return undefined;
    const exact = this.agents.get(reference.trim());
    if (exact && exact.id !== fromAgentId) return exact;

    const matches = Array.from(this.agents.values()).filter(agent => {
      if (agent.id === fromAgentId) return false;
      return agent.id.toLowerCase() === normalized
        || agent.infoBase.roleName.toLowerCase() === normalized
        || agent.infoBase.displayName.toLowerCase() === normalized;
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  private listPeers(fromAgentId: string): RoomPeerInfo[] {
    return Array.from(this.agents.values())
      .filter(agent => agent.id !== fromAgentId)
      .map(agent => ({
        id: agent.id,
        roleName: agent.infoBase.roleName,
        displayName: agent.infoBase.displayName,
        status: agent.status,
      }));
  }

  private buildCallbacks(stream: RoomEventSink): SessionCallbacks {
    return {
      onText: text => {
        stream.state('review', 'text_stream');
        stream.text(text);
      },
      onThinking: thinking => {
        stream.event({ type: 'thinking', text: thinking });
      },
      onToolStart: (name, toolUseId, input) => {
        stream.state('running', 'tool_start');
        stream.event({ type: 'tool_start', name, toolUseId, input });
      },
      onToolEnd: (name, toolUseId, result) => {
        stream.state('waiting', 'tool_end');
        stream.event({ type: 'tool_end', name, toolUseId, result: result.slice(0, 4000) });
      },
      onToolDisplay: (name, content) => {
        stream.event({ type: 'tool_display', name, content });
      },
      onRetry: (attempt, maxRetries) => {
        stream.event({ type: 'retry', attempt, maxRetries });
      },
    };
  }

  private buildChannel(agent: RoomAgent, stream: RoomEventSink): ChannelCallbacks {
    return {
      chatId: agent.id,
      reply: async (_chatId, text) => {
        stream.state('review', 'channel_reply');
        stream.text(text);
      },
      sendFile: async (_chatId, filePath, fileName) => {
        stream.event({ type: 'file', filePath, fileName });
      },
    };
  }

  private buildRoomPrompt(agent: RoomAgent, text: string): string {
    const peers = this.listPeers(agent.id);
    const peerLines = peers.length
      ? peers.map(peer => `- ${peer.displayName} (${peer.roleName}) id=${peer.id} status=${peer.status}`).join('\n')
      : '- No other room agents are currently present.';
    return [
      `[dashboard-room-agent]`,
      `Room agent id: ${agent.id}`,
      `Role: ${agent.infoBase.displayName} (${agent.infoBase.roleName})`,
      `Workspace: ${agent.infoBase.cwd}`,
      `Room peers:`,
      peerLines,
      '',
      'You are working inside XiaoBa Dashboard Room with peer role pets. The room communication protocol is intentionally minimal and role-neutral: use room_message to send a private natural-language message to another agent when that helps achieve the result. Do not assume special workflow verbs; express intent in the message text. Keep replies concise and focused on the requested outcome.',
      '',
      text,
    ].join('\n');
  }

  private listRoleOptions(): Array<{
    roleName: string;
    displayName: string;
    description: string;
    petId: string;
    spriteUrl: string;
  }> {
    return RoleResolver.listAvailableRoles().map(roleName => {
      const config = RoleResolver.getRoleConfig(roleName);
      const petId = this.resolveRolePetId(roleName);
      return {
        roleName,
        displayName: config?.displayName || roleName,
        description: config?.description || '',
        petId,
        spriteUrl: `/api/pet/pets/${encodeURIComponent(petId)}/spritesheet`,
      };
    });
  }

  private resolveRolePetId(roleName: string): string {
    const config = RoleResolver.getRoleConfig(roleName);
    const configured = typeof config?.metadata?.petId === 'string'
      ? config.metadata.petId.trim()
      : '';
    if (configured && this.petExists(configured)) {
      return configured;
    }
    return this.petExists('xiaoba') ? 'xiaoba' : 'pochiba';
  }

  private petExists(petId: string): boolean {
    return this.petRoots().some(root => fs.existsSync(path.join(root, petId, 'pet.json')));
  }

  private petRoots(): string[] {
    const roots = [
      path.resolve(process.cwd(), 'dashboard', 'pets'),
      path.resolve(process.env.XIAOBA_APP_ROOT || '', 'dashboard', 'pets'),
      path.resolve(process.env.XIAOBA_PETS_DIR || ''),
      ...(process.env.XIAOBA_INCLUDE_CODEX_PETS === 'true'
        ? [path.join(os.homedir(), '.codex', 'pets')]
        : []),
    ];
    return Array.from(new Set(roots))
      .filter(root => root && root !== path.resolve(process.cwd()) && fs.existsSync(root));
  }
}

class RoomMessageTool implements Tool {
  definition: ToolDefinition = {
    name: 'room_message',
    description: 'Send a private natural-language message to another Room agent. This is the only Room agent-to-agent communication primitive.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Target agent id. A unique role name or display name also works when only one matching agent is in the room.',
        },
        text: {
          type: 'string',
          description: 'Message text to deliver. Put the full intent and expected result in natural language.',
        },
      },
      required: ['to', 'text'],
    },
  };

  constructor(
    private readonly fromAgentId: string,
    private readonly messenger: RoomMessenger,
  ) {}

  async execute(args: any, _context: ToolExecutionContext): Promise<string> {
    const to = typeof args?.to === 'string' ? args.to.trim() : '';
    const text = typeof args?.text === 'string' ? args.text.trim() : '';
    if (!to) throw new Error('to required');
    if (!text) throw new Error('text required');

    const receipt = await this.messenger.sendPrivateMessage(this.fromAgentId, to, text);
    return [
      'room_message delivered',
      `message_id=${receipt.messageId}`,
      `to=${receipt.toName}`,
      `to_agent_id=${receipt.toAgentId}`,
    ].join('\n');
  }
}

class RoomEventStream {
  isOpen = false;
  hasText = false;
  private fanout?: (event: RoomEvent) => RoomEvent;

  constructor(private readonly res: Response) {}

  setFanout(fanout: (event: RoomEvent) => RoomEvent): void {
    this.fanout = fanout;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.flushHeaders?.();
  }

  state(state: string, reason: string): void {
    this.event({ type: 'state', state, reason });
  }

  text(text: string): void {
    this.hasText = true;
    this.event({ type: 'text', text });
  }

  done(text: string, visibleToUser: boolean): void {
    this.event({ type: 'done', text, visibleToUser });
    this.res.end();
  }

  event(event: RoomEvent): void {
    const output = this.fanout?.(event) || event;
    if (!this.isOpen) return;
    this.res.write(`data: ${JSON.stringify(output)}\n\n`);
  }
}

class RoomLocalEventSink implements RoomEventSink {
  constructor(private readonly publish: (event: RoomEvent) => void) {}

  event(event: RoomEvent): void {
    this.publish(event);
  }

  state(state: string, reason: string): void {
    this.event({ type: 'state', state, reason });
  }

  text(text: string): void {
    this.event({ type: 'text', text });
  }

  done(text: string, visibleToUser: boolean): void {
    this.event({ type: 'done', text, visibleToUser });
  }
}

class RoomEventHub {
  private readonly subscribers = new Map<string, Set<Response>>();
  private readonly history = new Map<string, RoomEvent[]>();
  private nextId = 1;
  private readonly historyLimit = 100;

  subscribe(agentId: string, res: Response, options: { replay?: boolean } = {}): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this.write(res, {
      type: 'connected',
      agentId,
      timestamp: new Date().toISOString(),
    });

    if (options.replay) {
      for (const event of this.history.get(agentId) || []) {
        this.write(res, event);
      }
    }

    const set = this.subscribers.get(agentId) || new Set<Response>();
    set.add(res);
    this.subscribers.set(agentId, set);
    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) {
        this.subscribers.delete(agentId);
      }
    });
  }

  publish(agentId: string, event: RoomEvent): RoomEvent {
    const decorated = {
      ...event,
      id: this.nextId++,
      agentId,
      timestamp: new Date().toISOString(),
    };
    const events = this.history.get(agentId) || [];
    events.push(decorated);
    if (events.length > this.historyLimit) {
      events.splice(0, events.length - this.historyLimit);
    }
    this.history.set(agentId, events);

    for (const res of this.subscribers.get(agentId) || []) {
      this.write(res, decorated);
    }
    return decorated;
  }

  private write(res: Response, event: RoomEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
