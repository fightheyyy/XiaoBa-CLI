import { spawn, ChildProcessWithoutNullStreams, execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';

type CodexJobStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'spawn_error' | 'orphaned';
type CodexJobKind = 'start' | 'resume';

interface CodexJobFile {
  version: 1;
  jobId: string;
  kind: CodexJobKind;
  status: CodexJobStatus;
  cwd: string;
  prompt: string;
  command: string;
  args: string[];
  sandbox?: string;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  completedAt?: string;
  pid?: number;
  exitCode?: number | null;
  timedOut?: boolean;
  codexSessionId?: string;
  resumeFromSessionId?: string;
  parentJobId?: string;
  eventCount: number;
  lastEventType?: string;
  lastMessage?: string;
  stderrPreview?: string;
  paths: {
    dir: string;
    job: string;
    events: string;
    stderr: string;
    lastMessage: string;
  };
}

interface ActiveCodexJob {
  child: ChildProcessWithoutNullStreams;
  timer: NodeJS.Timeout;
  stdoutBuffer: string;
}

interface StartCodexJobOptions {
  message: string;
  jobId?: string;
  cwd: string;
  timeoutMs: number;
  allowEdits: boolean;
  sandbox?: string;
  model?: string;
  skipGitRepoCheck: boolean;
}

interface ResumeCodexJobOptions extends StartCodexJobOptions {
  parentJobId?: string;
  codexSessionId: string;
}

interface CodexJobStatusOptions {
  recentEvents: number;
  includeGitStatus: boolean;
  maxChars: number;
  verbose: boolean;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RECENT_EVENTS = 12;
const MAX_MESSAGE_CHARS = 8000;
const MAX_STATUS_CHARS = 24000;
const MAX_COMPACT_STATUS_CHARS = 2400;
const JOB_ROOT = path.resolve('data', 'codex-jobs');

export class CodexJobStartTool implements Tool {
  definition: ToolDefinition = {
    name: 'codex_job_start',
    description: [
      '后台启动 Codex 工程任务，使用 codex exec --json 输出结构化事件。',
      '此工具立即返回 job_id，不等待 Codex 完成；后续用 codex_job_status 查询进度。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '发给 Codex 的完整工程任务。'
        },
        job_id: {
          type: 'string',
          description: '可选的稳定 job id；不填自动生成。'
        },
        cwd: {
          type: 'string',
          description: 'Codex 工作目录。默认当前工具工作目录。'
        },
        timeout_ms: {
          type: 'number',
          description: '超时时间，默认 600000ms。'
        },
        allow_edits: {
          type: 'boolean',
          description: '是否允许修改工作区。默认 true。'
        },
        sandbox: {
          type: 'string',
          enum: ['read-only', 'workspace-write', 'danger-full-access'],
          description: 'Codex sandbox。默认随 allow_edits 选择 workspace-write/read-only。'
        },
        model: {
          type: 'string',
          description: '可选 Codex model。'
        },
        skip_git_repo_check: {
          type: 'boolean',
          description: '是否允许在非 git 仓库运行。默认 false。'
        }
      },
      required: ['message']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const message = readMessage(args.message);
    if (!message) {
      return '错误：message 不能为空';
    }

    let result: CodexJobFile;
    try {
      result = CodexJobManager.start({
        message,
        jobId: args.job_id ? safeSegment(String(args.job_id)) : undefined,
        cwd: resolveCwd(context.workingDirectory, args.cwd),
        timeoutMs: readPositiveNumber(args.timeout_ms, DEFAULT_TIMEOUT_MS),
        allowEdits: args.allow_edits !== false,
        sandbox: normalizeSandbox(args.sandbox, args.allow_edits !== false),
        model: readOptionalString(args.model),
        skipGitRepoCheck: args.skip_git_repo_check === true,
      });
    } catch (error: any) {
      return `codex_job_start 启动失败: ${String(error?.message || error)}`;
    }

    return [
      `codex: running=${result.status === 'running' ? 'true' : 'false'} status=${result.status}`,
      `job_id=${result.jobId}`,
    ].join('\n');
  }
}

export class CodexJobStatusTool implements Tool {
  definition: ToolDefinition = {
    name: 'codex_job_status',
    description: '查询 Codex job 状态。默认返回低 token 摘要；需要完整 JSONL 事件和 git status 时传 verbose=true。',
    parameters: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'codex_job_start 或 codex_job_resume 返回的 job_id。'
        },
        recent_events: {
          type: 'number',
          description: '返回最近多少条事件，默认 12。'
        },
        include_git_status: {
          type: 'boolean',
          description: '是否附带 cwd 的 git status --short。compact 默认 false；verbose 默认 true。'
        },
        max_chars: {
          type: 'number',
          description: '最大返回字符数。compact 默认 2400；verbose 默认 24000。'
        },
        verbose: {
          type: 'boolean',
          description: '是否返回完整 JSON、最近事件和 git status。默认 false，避免轮询吃 token。'
        },
        wait_ms: {
          type: 'number',
          description: '如果 job 仍在 running，最多等待多久再返回，默认 0。建议 30000。'
        },
        poll_interval_ms: {
          type: 'number',
          description: 'wait_ms 启用时的轮询间隔，默认 5000ms。'
        }
      },
      required: ['job_id']
    }
  };

  async execute(args: any, _context: ToolExecutionContext): Promise<string> {
    const jobId = safeSegment(String(args.job_id || ''));
    if (!jobId) {
      return '错误：job_id 不能为空';
    }

    const waitMs = readNonNegativeNumber(args.wait_ms, 0);
    const pollIntervalMs = readPositiveNumber(args.poll_interval_ms, 5000);
    if (waitMs > 0) {
      await CodexJobManager.wait(jobId, waitMs, pollIntervalMs);
    }

    const verbose = args.verbose === true;
    return CodexJobManager.status(jobId, {
      recentEvents: readPositiveNumber(args.recent_events, DEFAULT_RECENT_EVENTS),
      includeGitStatus: args.include_git_status === true || (verbose && args.include_git_status !== false),
      maxChars: readPositiveNumber(
        args.max_chars,
        verbose ? MAX_STATUS_CHARS : MAX_COMPACT_STATUS_CHARS,
      ),
      verbose,
    });
  }
}

export class CodexJobResumeTool implements Tool {
  definition: ToolDefinition = {
    name: 'codex_job_resume',
    description: [
      '基于已有 Codex session 追加一轮任务，使用 codex exec resume --json 后台运行。',
      '需要传 parent job_id 或 codex_session_id；此工具立即返回新的 job_id。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '本轮返工或继续任务的指令。'
        },
        job_id: {
          type: 'string',
          description: '可选，新 resume job 的 job id；不填自动生成。'
        },
        parent_job_id: {
          type: 'string',
          description: '上一轮 job id；工具会从中读取 codexSessionId。'
        },
        codex_session_id: {
          type: 'string',
          description: 'Codex 官方 session id。parent_job_id 取不到时可直接传。'
        },
        cwd: {
          type: 'string',
          description: '运行 cwd。默认继承 parent job cwd，否则用当前工具工作目录。'
        },
        timeout_ms: {
          type: 'number',
          description: '超时时间，默认 600000ms。'
        },
        allow_edits: {
          type: 'boolean',
          description: '保留给策略判断；resume 主要沿用 Codex 原 session。默认 true。'
        },
        model: {
          type: 'string',
          description: '可选 Codex model。'
        },
        skip_git_repo_check: {
          type: 'boolean',
          description: '是否允许在非 git 仓库运行。默认 false。'
        }
      },
      required: ['message']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const message = readMessage(args.message);
    if (!message) {
      return '错误：message 不能为空';
    }

    const parentJobId = args.parent_job_id ? safeSegment(String(args.parent_job_id)) : undefined;
    const parentJob = parentJobId ? CodexJobManager.read(parentJobId) : undefined;
    const codexSessionId = readOptionalString(args.codex_session_id) || parentJob?.codexSessionId;
    if (!codexSessionId) {
      return '错误：缺少 codex_session_id，且 parent_job_id 中还没有解析到 Codex session id。请先用 codex_job_status 查看上一轮是否已产生 session。';
    }

    let result: CodexJobFile;
    try {
      result = CodexJobManager.resume({
        message,
        jobId: args.job_id ? safeSegment(String(args.job_id)) : undefined,
        parentJobId,
        codexSessionId,
        cwd: resolveCwd(context.workingDirectory, args.cwd || parentJob?.cwd),
        timeoutMs: readPositiveNumber(args.timeout_ms, DEFAULT_TIMEOUT_MS),
        allowEdits: args.allow_edits !== false,
        sandbox: parentJob?.sandbox,
        model: readOptionalString(args.model),
        skipGitRepoCheck: args.skip_git_repo_check === true,
      });
    } catch (error: any) {
      return `codex_job_resume 启动失败: ${String(error?.message || error)}`;
    }

    return [
      `codex: running=${result.status === 'running' ? 'true' : 'false'} status=${result.status}`,
      `job_id=${result.jobId}`,
      `session=${codexSessionId}`,
    ].join('\n');
  }
}

export class CodexJobCancelTool implements Tool {
  definition: ToolDefinition = {
    name: 'codex_job_cancel',
    description: '取消正在运行的 Codex job。Windows 下会尝试 taskkill /T /F 杀进程树。',
    parameters: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: '要取消的 job id。'
        }
      },
      required: ['job_id']
    }
  };

  async execute(args: any, _context: ToolExecutionContext): Promise<string> {
    const jobId = safeSegment(String(args.job_id || ''));
    if (!jobId) {
      return '错误：job_id 不能为空';
    }

    return CodexJobManager.cancel(jobId);
  }
}

class CodexJobManager {
  private static active = new Map<string, ActiveCodexJob>();

  static start(options: StartCodexJobOptions): CodexJobFile {
    const jobId = options.jobId || createJobId('codex');
    const paths = buildJobPaths(jobId);
    ensureFreshJobDir(paths.dir);

    const args = buildStartArgs(options, paths.lastMessage);
    const job = createJobFile({
      jobId,
      kind: 'start',
      cwd: options.cwd,
      prompt: options.message,
      command: 'codex',
      args,
      sandbox: options.sandbox,
      timeoutMs: options.timeoutMs,
      paths,
    });

    this.launch(job, options.message);
    return this.read(jobId) || job;
  }

  static resume(options: ResumeCodexJobOptions): CodexJobFile {
    const jobId = options.jobId || createJobId('codex-resume');
    const paths = buildJobPaths(jobId);
    ensureFreshJobDir(paths.dir);

    const args = buildResumeArgs(options, paths.lastMessage);
    const job = createJobFile({
      jobId,
      kind: 'resume',
      cwd: options.cwd,
      prompt: options.message,
      command: 'codex',
      args,
      sandbox: options.sandbox,
      timeoutMs: options.timeoutMs,
      paths,
      parentJobId: options.parentJobId,
      resumeFromSessionId: options.codexSessionId,
      codexSessionId: options.codexSessionId,
    });

    this.launch(job, options.message);
    return this.read(jobId) || job;
  }

  static read(jobId: string): CodexJobFile | undefined {
    const jobPath = buildJobPaths(jobId).job;
    try {
      return JSON.parse(fs.readFileSync(jobPath, 'utf-8')) as CodexJobFile;
    } catch {
      return undefined;
    }
  }

  static status(
    jobId: string,
    options: CodexJobStatusOptions,
  ): string {
    const job = this.read(jobId);
    if (!job) {
      return `错误：找不到 Codex job: ${jobId}`;
    }

    const active = this.active.get(jobId);
    if (job.status === 'running' && !active && !isProcessProbablyAlive(job.pid)) {
      job.status = 'orphaned';
      job.updatedAt = new Date().toISOString();
      persistJob(job);
    }

    const lastMessage = readOptionalFile(job.paths.lastMessage) || job.lastMessage || '';
    const stderr = readOptionalFile(job.paths.stderr);
    if (!options.verbose) {
      return formatCompactStatus(job, lastMessage, stderr, options.maxChars);
    }

    const recentEvents = readRecentEvents(job.paths.events, options.recentEvents);
    const gitStatus = options.includeGitStatus ? collectGitStatus(job.cwd) : '';

    const payload = {
      job_id: job.jobId,
      status: job.status,
      kind: job.kind,
      pid: job.pid || null,
      cwd: job.cwd,
      codex_session_id: job.codexSessionId || null,
      parent_job_id: job.parentJobId || null,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      completed_at: job.completedAt || null,
      exit_code: job.exitCode ?? null,
      event_count: job.eventCount,
      last_event_type: job.lastEventType || null,
      job_file: job.paths.job,
      events_file: job.paths.events,
      stderr_file: job.paths.stderr,
      last_message_file: job.paths.lastMessage,
      last_message: truncate(lastMessage, 6000),
      stderr_preview: truncate(stderr || job.stderrPreview || '', 3000),
      recent_events: recentEvents,
      git_status: gitStatus,
    };

    return truncate(JSON.stringify(payload, null, 2), options.maxChars);
  }

  static async wait(jobId: string, waitMs: number, pollIntervalMs: number): Promise<void> {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const job = this.read(jobId);
      if (!job || job.status !== 'running') {
        return;
      }
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
  }

  static async cancel(jobId: string): Promise<string> {
    const job = this.read(jobId);
    if (!job) {
      return `错误：找不到 Codex job: ${jobId}`;
    }

    const active = this.active.get(jobId);
    if (!active && !isProcessProbablyAlive(job.pid)) {
      if (job.status === 'running') {
        job.status = 'orphaned';
        job.updatedAt = new Date().toISOString();
        persistJob(job);
      }
      return `codex_job_cancel: job=${jobId} 当前没有可管理的运行进程，status=${job.status}`;
    }

    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    persistJob(job);

    if (active) {
      clearTimeout(active.timer);
      this.active.delete(jobId);
      await killProcessTree(active.child.pid);
    } else {
      await killProcessTree(job.pid);
    }

    return `codex_job_cancel 已请求取消: job_id=${jobId}, pid=${job.pid || 'unknown'}`;
  }

  private static launch(job: CodexJobFile, input: string): void {
    persistJob(job);
    fs.writeFileSync(job.paths.events, '', 'utf-8');
    fs.writeFileSync(job.paths.stderr, '', 'utf-8');

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(job.command, job.args, {
        cwd: job.cwd,
        shell: process.platform === 'win32',
        windowsHide: true,
        env: process.env,
      });
    } catch (error: any) {
      job.status = 'spawn_error';
      job.stderrPreview = String(error?.message || error);
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      persistJob(job);
      return;
    }

    job.pid = child.pid;
    persistJob(job);

    const timer = setTimeout(() => {
      const current = this.read(job.jobId) || job;
      if (current.status !== 'running') {
        return;
      }
      current.status = 'timeout';
      current.timedOut = true;
      current.updatedAt = new Date().toISOString();
      persistJob(current);
      killProcessTree(child.pid).catch(() => undefined);
    }, job.timeoutMs);

    const active: ActiveCodexJob = {
      child,
      timer,
      stdoutBuffer: '',
    };
    this.active.set(job.jobId, active);

    child.stdout.on('data', chunk => {
      active.stdoutBuffer += chunk.toString('utf-8');
      active.stdoutBuffer = drainJsonLines(job.jobId, active.stdoutBuffer);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf-8');
      fs.appendFileSync(job.paths.stderr, text, 'utf-8');
      const current = this.read(job.jobId) || job;
      current.stderrPreview = truncate((current.stderrPreview || '') + text, 4000);
      const sessionId = extractSessionIdFromText(text);
      if (sessionId) {
        current.codexSessionId = sessionId;
      }
      current.updatedAt = new Date().toISOString();
      persistJob(current);
    });

    child.on('error', error => {
      const current = this.read(job.jobId) || job;
      current.status = 'spawn_error';
      current.stderrPreview = truncate(`${current.stderrPreview || ''}\n${String(error.message || error)}`, 4000);
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
      clearTimeout(timer);
      this.active.delete(job.jobId);
      persistJob(current);
    });

    child.on('close', code => {
      const activeJob = this.active.get(job.jobId);
      const rest = activeJob?.stdoutBuffer || '';
      if (rest.trim()) {
        processJsonLine(job.jobId, rest.trim());
      }

      const current = this.read(job.jobId) || job;
      const wasTimeout = current.status === 'timeout';
      const wasCancelled = current.status === 'cancelled';
      current.exitCode = code;
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
      if (!wasTimeout && !wasCancelled && current.status !== 'spawn_error') {
        current.status = code === 0 ? 'completed' : 'failed';
      }
      const lastMessage = readOptionalFile(current.paths.lastMessage);
      if (lastMessage) {
        current.lastMessage = truncate(lastMessage, MAX_MESSAGE_CHARS);
      }
      clearTimeout(timer);
      this.active.delete(job.jobId);
      persistJob(current);
    });

    child.stdin.write(input);
    child.stdin.end();
  }
}

function buildStartArgs(options: StartCodexJobOptions, lastMessagePath: string): string[] {
  const args = [
    'exec',
    '--json',
    '--cd',
    options.cwd,
    '--sandbox',
    options.sandbox || normalizeSandbox(undefined, options.allowEdits),
    '-o',
    lastMessagePath,
  ];
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }
  args.push('-');
  return args;
}

function buildResumeArgs(options: ResumeCodexJobOptions, lastMessagePath: string): string[] {
  const args = [
    'exec',
    'resume',
    '--json',
    '-o',
    lastMessagePath,
  ];
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }
  args.push(options.codexSessionId, '-');
  return args;
}

function createJobFile(input: {
  jobId: string;
  kind: CodexJobKind;
  cwd: string;
  prompt: string;
  command: string;
  args: string[];
  sandbox?: string;
  timeoutMs: number;
  paths: CodexJobFile['paths'];
  parentJobId?: string;
  resumeFromSessionId?: string;
  codexSessionId?: string;
}): CodexJobFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    jobId: input.jobId,
    kind: input.kind,
    status: 'running',
    cwd: input.cwd,
    prompt: input.prompt,
    command: input.command,
    args: input.args,
    sandbox: input.sandbox,
    timeoutMs: input.timeoutMs,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    parentJobId: input.parentJobId,
    resumeFromSessionId: input.resumeFromSessionId,
    codexSessionId: input.codexSessionId,
    eventCount: 0,
    paths: input.paths,
  };
}

function buildJobPaths(jobId: string): CodexJobFile['paths'] {
  const dir = path.join(JOB_ROOT, safeSegment(jobId));
  return {
    dir,
    job: path.join(dir, 'job.json'),
    events: path.join(dir, 'events.jsonl'),
    stderr: path.join(dir, 'stderr.log'),
    lastMessage: path.join(dir, 'last-message.txt'),
  };
}

function ensureFreshJobDir(dir: string): void {
  if (fs.existsSync(dir)) {
    throw new Error(`Codex job directory already exists: ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
}

function persistJob(job: CodexJobFile): void {
  fs.mkdirSync(job.paths.dir, { recursive: true });
  fs.writeFileSync(job.paths.job, JSON.stringify(job, null, 2), 'utf-8');
}

function drainJsonLines(jobId: string, buffer: string): string {
  let rest = buffer;
  let newlineIndex = rest.indexOf('\n');
  while (newlineIndex >= 0) {
    const line = rest.slice(0, newlineIndex).trim();
    rest = rest.slice(newlineIndex + 1);
    if (line) {
      processJsonLine(jobId, line);
    }
    newlineIndex = rest.indexOf('\n');
  }
  return rest;
}

function processJsonLine(jobId: string, line: string): void {
  const job = CodexJobManager.read(jobId);
  if (!job) {
    return;
  }

  fs.appendFileSync(job.paths.events, line + '\n', 'utf-8');
  job.eventCount++;
  try {
    const event = JSON.parse(line);
    job.lastEventType = readEventType(event);
    const sessionId = findSessionId(event);
    if (sessionId) {
      job.codexSessionId = sessionId;
    }
    const message = extractMessageText(event);
    if (message) {
      job.lastMessage = truncate(message, MAX_MESSAGE_CHARS);
    }
  } catch {
    job.lastEventType = 'unparsed';
  }
  job.updatedAt = new Date().toISOString();
  persistJob(job);
}

function readRecentEvents(filePath: string, limit: number): Array<Record<string, unknown>> {
  const content = readOptionalFile(filePath);
  if (!content) {
    return [];
  }
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .map(line => {
      try {
        const event = JSON.parse(line);
        return {
          type: readEventType(event),
          summary: truncate(extractMessageText(event) || JSON.stringify(event), 900),
        };
      } catch {
        return {
          type: 'unparsed',
          summary: truncate(line, 900),
        };
      }
    });
}

function collectGitStatus(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'status', '--short'], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 512 * 1024,
    }).trim();
  } catch (error: any) {
    return `git status 获取失败: ${String(error?.message || error)}`;
  }
}

function formatCompactStatus(
  job: CodexJobFile,
  lastMessage: string,
  stderr: string,
  maxChars: number,
): string {
  const running = job.status === 'running';
  const lines = [
    `codex: running=${running ? 'true' : 'false'} status=${job.status}`,
    `job_id=${job.jobId}`,
  ];

  if (job.codexSessionId) {
    lines.push(`session=${job.codexSessionId}`);
  }

  const message = singleLine(lastMessage || job.lastMessage || '');
  if (message) {
    lines.push(`output=${truncate(message, 1200)}`);
  }

  const stderrPreview = singleLine(stderr || job.stderrPreview || '');
  if (stderrPreview) {
    lines.push(`error=${truncate(stderrPreview, 600)}`);
  }

  return truncate(lines.join('\n'), maxChars);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readEventType(event: any): string {
  return String(event?.type || event?.event || event?.kind || 'unknown');
}

function extractMessageText(event: any): string {
  const direct = [
    event?.message,
    event?.text,
    event?.content,
    event?.delta,
    event?.last_message,
    event?.lastMessage,
  ].find(value => typeof value === 'string' && value.trim());
  if (direct) {
    return direct.trim();
  }

  const item = event?.item || event?.data || event?.payload;
  if (item && item !== event) {
    return extractMessageText(item);
  }

  if (Array.isArray(event?.content)) {
    return event.content
      .map((part: any) => typeof part === 'string' ? part : part?.text)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function findSessionId(value: any): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      const normalized = key.toLowerCase().replace(/[_-]/g, '');
      if (normalized === 'sessionid' || normalized === 'conversationid' || normalized === 'threadid') {
        return raw;
      }
      const eventType = readEventType(value).toLowerCase();
      if (normalized === 'id' && (eventType.includes('session') || eventType.includes('thread'))) {
        return raw;
      }
    }
  }

  for (const raw of Object.values(value)) {
    if (raw && typeof raw === 'object') {
      const found = findSessionId(raw);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

function extractSessionIdFromText(text: string): string | undefined {
  const match = text.match(/session id:\s*([a-zA-Z0-9_-]+)/i);
  return match?.[1];
}

function collectProcessExists(pid: number | undefined): boolean {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isProcessProbablyAlive(pid: number | undefined): boolean {
  return collectProcessExists(pid);
}

function killProcessTree(pid: number | undefined): Promise<void> {
  return new Promise(resolve => {
    if (!pid) {
      resolve();
      return;
    }

    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore: process may have already exited.
    }
    resolve();
  });
}

function createJobId(prefix: string): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `${prefix}-${ts}-${randomUUID().slice(0, 8)}`;
}

function readMessage(value: unknown): string {
  return String(value || '').trim();
}

function readOptionalString(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function readOptionalFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function resolveCwd(base: string, value: unknown): string {
  const text = String(value || '.').trim();
  return path.resolve(base, text || '.');
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeSandbox(value: unknown, allowEdits: boolean): string {
  const text = String(value || '').trim();
  if (['read-only', 'workspace-write', 'danger-full-access'].includes(text)) {
    return text;
  }
  return allowEdits ? 'workspace-write' : 'read-only';
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || '';
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}
