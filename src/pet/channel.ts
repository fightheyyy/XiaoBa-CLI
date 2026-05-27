import { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AIService } from '../utils/ai-service';
import { createRoleAwareToolManager } from '../bootstrap/tool-manager';
import { SkillManager } from '../skills/skill-manager';
import { AgentSession, AgentServices, SessionCallbacks } from '../core/agent-session';
import { MessageSessionManager } from '../core/message-session-manager';
import { ChannelCallbacks } from '../types/tool';
import { Logger } from '../utils/logger';
import { RoleResolver } from '../utils/role-resolver';
import { PetChatHistoryStore } from './chat-history-store';

type PetState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

interface PetManifest {
  id: string;
  displayName?: string;
  description?: string;
  spritesheetPath?: string;
}

interface PetEvent {
  type: string;
  id?: number;
  petId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

const DEFAULT_SESSION_TTL = 60 * 60 * 1000;
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

export function createPetRouter(): Router {
  const channel = new PetChannel();
  return channel.router;
}

export class PetChannel {
  readonly router = Router();
  private readonly services: AgentServices;
  private readonly sessionManager: MessageSessionManager;
  private readonly skillsReady: Promise<void>;
  private readonly chatHistory = new PetChatHistoryStore();
  private readonly events = new PetEventHub(this.chatHistory);
  private readonly messageQueues = new Map<string, Promise<void>>();

  constructor() {
    const skillManager = new SkillManager();
    this.services = {
      aiService: new AIService(),
      toolManager: createRoleAwareToolManager(),
      skillManager,
    };
    this.skillsReady = skillManager.loadSkills()
      .catch((err: any) => Logger.warning(`[pet] Skills 加载失败: ${err.message}`));

    this.sessionManager = new MessageSessionManager(
      this.services,
      'pet',
      DEFAULT_SESSION_TTL,
    );

    this.sessionManager.setWakeupSendFn(async (channelId, text) => {
      Logger.info(`[pet:${channelId}] wakeup: ${text.slice(0, 120)}`);
    });

    this.mountRoutes();
  }

  async destroy(): Promise<void> {
    this.events.close();
    await this.sessionManager.destroy();
  }

  private mountRoutes(): void {
    this.router.get('/pet/pets', (_req, res) => {
      const pets = this.listPets();
      const activeRole = RoleResolver.getActiveRoleName() || null;
      const rolePetId = this.resolveRolePetId(activeRole, pets);
      res.json({
        pets,
        defaultPetId: this.resolveDefaultPetId(pets, rolePetId),
        rolePetId,
        activeRole,
      });
    });

    this.router.get('/pet/pets/:petId/spritesheet', (req, res) => {
      try {
        const pet = this.resolvePet(req.params.petId);
        res.sendFile(pet.spritesheetPath, err => {
          if (!err || res.headersSent) return;
          res.status(404).json({ error: err.message });
        });
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    });

    this.router.post('/pet/wake', async (req, res) => {
      try {
        const petId = this.normalizePetId(req.body?.petId);
        const sessionKey = this.sessionKey(petId);
        this.sessionManager.getOrCreate(sessionKey, sessionKey);
        this.events.publish(petId, { type: 'state', state: 'waving', reason: 'wake' });
        res.json({
          ok: true,
          sessionKey,
          petId,
          state: 'waving',
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    this.router.post('/pet/message', async (req, res) => {
      await this.handleMessage(req.body, res);
    });

    this.router.get('/pet/events', (req, res) => {
      this.handleEvents(req, res);
    });

    this.router.get('/pet/history', (req, res) => {
      try {
        const petId = this.normalizePetId(req.query.petId);
        const limit = this.normalizeHistoryLimit(req.query.limit);
        res.json({
          petId,
          events: this.chatHistory.read(petId, limit),
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    this.router.delete('/pet/history', (req, res) => {
      try {
        const petId = this.normalizePetId(req.query.petId || req.body?.petId);
        this.chatHistory.delete(petId);
        this.events.clear(petId);
        res.json({ ok: true, petId });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });
  }

  private async handleMessage(body: any, res: Response): Promise<void> {
    const stream = new PetEventStream(res);
    let session: AgentSession | undefined;

    try {
      await this.skillsReady;

      const petId = this.normalizePetId(body?.petId);
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text) {
        res.status(400).json({ error: 'text required' });
        return;
      }
      const source = typeof body?.source === 'string' && body.source.trim()
        ? body.source.trim().slice(0, 40)
        : 'unknown';

      const sessionKey = this.sessionKey(petId);
      const activeSession = this.sessionManager.getOrCreate(sessionKey, sessionKey);
      session = activeSession;
      stream.setFanout(event => this.events.publish(petId, event));
      const channel = this.buildChannel(sessionKey, stream);
      const callbacks = this.buildCallbacks(stream);

      stream.open();
      activeSession.runWithLogContext(() => Logger.info(`[${sessionKey}] 收到 pet 消息 (${source}): ${text.slice(0, 120)}`));
      stream.event({ type: 'user_message', text, source, sessionKey });

      const result = await this.enqueueMessage(sessionKey, async () => {
        stream.state('waiting', 'processing');

        let resultText = '';
        let visibleToUser = true;
        if (text.startsWith('/')) {
          const parts = text.slice(1).split(/\s+/).filter(Boolean);
          const command = parts[0] || '';
          const args = parts.slice(1);
          const commandResult = await activeSession.handleCommand(command, args, callbacks);
          if (command.toLowerCase() === 'clear' && args.includes('--all')) {
            this.chatHistory.delete(petId);
            this.events.clear(petId);
          }
          resultText = commandResult.reply || '';
          visibleToUser = commandResult.handled;
          if (!commandResult.handled) {
            resultText = `未识别命令：/${command}`;
          }
        } else {
          const messageResult = await activeSession.handleMessage(text, { callbacks, channel });
          resultText = messageResult.text;
          visibleToUser = messageResult.visibleToUser;
        }

        return { resultText, visibleToUser };
      });

      if (!stream.hasText && result.resultText) {
        stream.text(result.resultText);
      }
      stream.state('waving', 'done');
      stream.done(result.resultText, result.visibleToUser);
    } catch (err: any) {
      const logError = () => Logger.error(`[pet] 消息处理失败: ${err.message}`);
      if (session) {
        session.runWithLogContext(logError);
      } else {
        logError();
      }
      if (!stream.isOpen) {
        res.status(500).json({ error: err.message });
        return;
      }
      stream.state('failed', 'error');
      stream.event({ type: 'error', message: err.message || String(err) });
      stream.done('', false);
    }
  }

  private enqueueMessage<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.messageQueues.get(sessionKey) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(task);
    const stored = queued
      .then(() => undefined, () => undefined)
      .finally(() => {
        if (this.messageQueues.get(sessionKey) === stored) {
          this.messageQueues.delete(sessionKey);
        }
      });
    this.messageQueues.set(sessionKey, stored);
    return queued;
  }

  private handleEvents(req: Request, res: Response): void {
    try {
      const petId = this.normalizePetId(req.query.petId);
      const replay = req.query.replay === '1';
      this.events.subscribe(petId, res, { replay });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  private buildCallbacks(stream: PetEventStream): SessionCallbacks {
    return {
      onText: (text: string) => {
        stream.state('review', 'text_stream');
        stream.text(text);
      },
      onThinking: (thinking: string) => {
        stream.state('review', 'thinking');
        stream.event({ type: 'thinking', text: thinking });
      },
      onToolStart: (name: string, toolUseId: string, input: any) => {
        stream.state('running', 'tool_start');
        stream.event({ type: 'tool_start', name, toolUseId, input });
      },
      onToolEnd: (name: string, toolUseId: string, result: string) => {
        stream.state('waiting', 'tool_end');
        stream.event({ type: 'tool_end', name, toolUseId, result: result.slice(0, 4000) });
      },
      onToolDisplay: (name: string, content: string) => {
        stream.event({ type: 'tool_display', name, content });
      },
      onRetry: (attempt: number, maxRetries: number) => {
        stream.state('waiting', 'retry');
        stream.event({ type: 'retry', attempt, maxRetries });
      },
    };
  }

  private buildChannel(sessionKey: string, stream: PetEventStream): ChannelCallbacks {
    return {
      chatId: sessionKey,
      reply: async (_chatId: string, text: string) => {
        stream.state('review', 'channel_reply');
        stream.text(text);
      },
      sendFile: async (_chatId: string, filePath: string, fileName: string) => {
        stream.event({ type: 'file', filePath, fileName });
      },
    };
  }

  private listPets(): Array<PetManifest & { spriteUrl: string; source: string }> {
    const pets = new Map<string, PetManifest & { spriteUrl: string; source: string }>();

    for (const root of this.petRoots()) {
      if (!fs.existsSync(root.dir)) continue;
      for (const entry of fs.readdirSync(root.dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !PET_ID_PATTERN.test(entry.name)) continue;
        try {
          const resolved = this.readPet(path.join(root.dir, entry.name));
          if (!pets.has(resolved.manifest.id)) {
            pets.set(resolved.manifest.id, {
              ...resolved.manifest,
              spriteUrl: `/api/pet/pets/${encodeURIComponent(resolved.manifest.id)}/spritesheet`,
              source: root.label,
            });
          }
        } catch {
          // Ignore incomplete pet folders.
        }
      }
    }

    return Array.from(pets.values());
  }

  private resolveDefaultPetId(
    pets: Array<PetManifest & { spriteUrl: string; source: string }> = this.listPets(),
    rolePetId: string | null = this.resolveRolePetId(RoleResolver.getActiveRoleName() || null, pets),
  ): string | null {
    return rolePetId || pets.find(pet => pet.id === 'xiaoba')?.id || pets[0]?.id || null;
  }

  private resolveRolePetId(
    activeRole: string | null,
    pets: Array<PetManifest & { spriteUrl: string; source: string }>,
  ): string | null {
    if (!activeRole) return null;

    const config = RoleResolver.getRoleConfig(activeRole);
    const configured = typeof config?.metadata?.petId === 'string'
      ? config.metadata.petId.trim()
      : '';

    if (!configured || !PET_ID_PATTERN.test(configured)) {
      return null;
    }

    return pets.some(pet => pet.id === configured) ? configured : null;
  }

  private resolvePet(petId: string): { manifest: PetManifest; spritesheetPath: string } {
    const normalized = this.normalizePetId(petId);
    for (const root of this.petRoots()) {
      const petDir = path.join(root.dir, normalized);
      if (!fs.existsSync(petDir)) continue;
      return this.readPet(petDir);
    }
    throw new Error(`pet not found: ${normalized}`);
  }

  private readPet(petDir: string): { manifest: PetManifest; spritesheetPath: string } {
    const manifestPath = path.join(petDir, 'pet.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`pet.json not found: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PetManifest;
    const petId = this.normalizePetId(manifest.id || path.basename(petDir));
    const spritesheetName = manifest.spritesheetPath || 'spritesheet.webp';
    const spritesheetPath = path.resolve(petDir, spritesheetName);
    if (!spritesheetPath.startsWith(path.resolve(petDir) + path.sep) || !fs.existsSync(spritesheetPath)) {
      throw new Error(`spritesheet not found: ${spritesheetName}`);
    }

    return {
      manifest: {
        ...manifest,
        id: petId,
        spritesheetPath: path.basename(spritesheetPath),
      },
      spritesheetPath,
    };
  }

  private normalizePetId(value: unknown): string {
    const petId = typeof value === 'string' && value.trim()
      ? value.trim()
      : this.resolveDefaultPetId();

    if (!petId || !PET_ID_PATTERN.test(petId)) {
      throw new Error('invalid pet id');
    }
    return petId;
  }

  private normalizeHistoryLimit(value: unknown): number {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
    if (!Number.isFinite(parsed)) return 500;
    return Math.max(1, Math.min(2000, Math.trunc(parsed)));
  }

  private sessionKey(petId: string): string {
    return `pet:${petId}`;
  }

  private petRoots(): Array<{ dir: string; label: string }> {
    const roots = [
      { dir: path.resolve(process.cwd(), 'dashboard', 'pets'), label: 'bundled' },
      { dir: path.resolve(process.env.XIAOBA_APP_ROOT || '', 'dashboard', 'pets'), label: 'bundled' },
      { dir: path.resolve(process.env.XIAOBA_PETS_DIR || ''), label: 'custom' },
      ...(process.env.XIAOBA_INCLUDE_CODEX_PETS === 'true'
        ? [{ dir: path.join(os.homedir(), '.codex', 'pets'), label: 'codex' }]
        : []),
    ];

    const seen = new Set<string>();
    return roots
      .filter(root => root.dir && root.dir !== path.resolve(process.cwd()))
      .filter(root => {
        if (seen.has(root.dir)) return false;
        seen.add(root.dir);
        return true;
      });
  }
}

class PetEventStream {
  isOpen = false;
  hasText = false;
  private fanout?: (event: PetEvent) => void;

  constructor(private res: Response) {}

  setFanout(fanout: (event: PetEvent) => void): void {
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

  state(state: PetState, reason: string): void {
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

  event(event: PetEvent): void {
    this.fanout?.(event);
    if (!this.isOpen) return;
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

class PetEventHub {
  private readonly subscribers = new Map<string, Set<Response>>();
  private readonly history = new Map<string, PetEvent[]>();
  private nextId: number;
  private readonly historyLimit = 80;

  constructor(private readonly historyStore?: PetChatHistoryStore) {
    this.nextId = Math.max(1, (this.historyStore?.getMaxEventId() || 0) + 1);
  }

  subscribe(petId: string, res: Response, options: { replay?: boolean } = {}): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this.write(res, {
      type: 'connected',
      petId,
      timestamp: new Date().toISOString(),
    });

    if (options.replay) {
      for (const event of this.replayEvents(petId)) {
        this.write(res, event);
      }
    }

    const set = this.subscribers.get(petId) || new Set<Response>();
    set.add(res);
    this.subscribers.set(petId, set);

    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) {
        this.subscribers.delete(petId);
      }
    });
  }

  publish(petId: string, event: PetEvent): void {
    const decorated = {
      ...event,
      id: this.nextId++,
      petId,
      timestamp: new Date().toISOString(),
    };

    this.historyStore?.append(petId, decorated);
    const events = this.history.get(petId) || [];
    events.push(decorated);
    if (events.length > this.historyLimit) {
      events.splice(0, events.length - this.historyLimit);
    }
    this.history.set(petId, events);

    for (const res of this.subscribers.get(petId) || []) {
      this.write(res, decorated);
    }
  }

  close(): void {
    for (const responses of this.subscribers.values()) {
      for (const res of responses) {
        res.end();
      }
    }
    this.subscribers.clear();
  }

  clear(petId: string): void {
    this.history.delete(petId);
  }

  private replayEvents(petId: string): PetEvent[] {
    const byId = new Map<string, PetEvent>();
    for (const event of this.historyStore?.read(petId) || []) {
      byId.set(this.eventKey(event), event);
    }
    for (const event of this.history.get(petId) || []) {
      byId.set(this.eventKey(event), event);
    }

    return Array.from(byId.values()).sort((a, b) => {
      const aId = typeof a.id === 'number' ? a.id : Number.MAX_SAFE_INTEGER;
      const bId = typeof b.id === 'number' ? b.id : Number.MAX_SAFE_INTEGER;
      if (aId !== bId) return aId - bId;
      return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
    });
  }

  private eventKey(event: PetEvent): string {
    if (typeof event.id === 'number') return String(event.id);
    return `${event.timestamp || ''}:${event.type}:${JSON.stringify(event)}`;
  }

  private write(res: Response, event: PetEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
