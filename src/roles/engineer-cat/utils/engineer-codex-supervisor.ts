import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  EngineerTaskFile,
  EngineerTaskRunner,
  EngineerTaskStatus,
  readTask,
} from './engineer-task-runner';

export type EngineerSupervisorStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
export type EngineerSupervisorWorkerStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface EngineerSupervisorWorkerInput {
  workerId?: string;
  label?: string;
  request: string;
  cwd?: string;
  codexSessionId?: string;
  dependsOn?: string[];
  priority?: number;
  allowEdits?: boolean;
  sandbox?: string;
  model?: string;
  timeoutMs?: number;
  validationCommands?: string[];
  validationTimeoutMs?: number;
  skipGitRepoCheck?: boolean;
}

export interface EngineerSupervisorCreateOptions {
  supervisorId?: string;
  goal: string;
  cwd: string;
  maxParallel?: number;
  workers: EngineerSupervisorWorkerInput[];
}

export interface EngineerSupervisorStatusOptions {
  supervisorId: string;
  waitMs?: number;
  pollIntervalMs?: number;
  verbose?: boolean;
}

export interface EngineerSupervisorResumeOptions {
  supervisorId: string;
  workerId?: string;
  taskId?: string;
  feedback: string;
  cwd?: string;
  allowEdits?: boolean;
  sandbox?: string;
  model?: string;
  timeoutMs?: number;
  validationCommands?: string[];
  validationTimeoutMs?: number;
  skipGitRepoCheck?: boolean;
}

export interface EngineerSupervisorCancelOptions {
  supervisorId: string;
  workerId?: string;
}

export interface EngineerSupervisorWorker {
  workerId: string;
  label: string;
  request: string;
  cwd: string;
  codexSessionId?: string;
  dependsOn: string[];
  priority: number;
  status: EngineerSupervisorWorkerStatus;
  taskId: string;
  allowEdits: boolean;
  sandbox?: string;
  model?: string;
  timeoutMs?: number;
  validationCommands?: string[];
  validationTimeoutMs?: number;
  skipGitRepoCheck: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  codexJobId?: string;
  lastCodexSessionId?: string;
  validationStatus?: string;
  error?: string;
  lastMessage?: string;
  artifacts?: {
    task?: string;
    plan?: string;
    validation?: string;
    finalSummary?: string;
  };
}

export interface EngineerSupervisorFile {
  version: 1;
  supervisorId: string;
  status: EngineerSupervisorStatus;
  goal: string;
  cwd: string;
  maxParallel: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  workers: EngineerSupervisorWorker[];
  artifacts: {
    dir: string;
    supervisor: string;
    plan: string;
    aggregate: string;
  };
}

const DEFAULT_MAX_PARALLEL = 2;
const DEFAULT_POLL_INTERVAL_MS = 5000;

export class EngineerCodexSupervisor {
  constructor(private runner: EngineerTaskRunner) {}

  async create(options: EngineerSupervisorCreateOptions): Promise<EngineerSupervisorFile> {
    const goal = readText(options.goal);
    if (!goal) {
      throw new Error('goal 不能为空');
    }
    if (!Array.isArray(options.workers) || options.workers.length === 0) {
      throw new Error('workers 不能为空');
    }

    const supervisorId = options.supervisorId ? safeSegment(options.supervisorId) : createSupervisorId();
    const paths = buildSupervisorPaths(supervisorId);
    ensureFreshDir(paths.dir);
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const workers = options.workers.map((worker, index) => {
      const workerId = uniqueWorkerId(
        worker.workerId || worker.label || `worker-${index + 1}`,
        seen,
      );
      return createWorker({
        input: worker,
        index,
        supervisorId,
        workerId,
        cwd: worker.cwd || options.cwd,
        now,
      });
    });

    const supervisor: EngineerSupervisorFile = {
      version: 1,
      supervisorId,
      status: 'running',
      goal,
      cwd: options.cwd,
      maxParallel: normalizeMaxParallel(options.maxParallel),
      createdAt: now,
      updatedAt: now,
      workers,
      artifacts: paths,
    };

    persistSupervisor(supervisor);
    writeSupervisorPlan(supervisor);
    await this.startReadyWorkers(supervisor);
    finalizeSupervisor(supervisor);
    persistSupervisor(supervisor);
    writeSupervisorAggregate(supervisor);
    return supervisor;
  }

  async status(options: EngineerSupervisorStatusOptions): Promise<EngineerSupervisorFile | undefined> {
    const supervisor = readSupervisor(options.supervisorId);
    if (!supervisor) {
      return undefined;
    }

    await this.syncRunningWorkers(supervisor, options);
    await this.startReadyWorkers(supervisor);
    finalizeSupervisor(supervisor);
    persistSupervisor(supervisor);
    writeSupervisorAggregate(supervisor);
    return supervisor;
  }

  async resume(options: EngineerSupervisorResumeOptions): Promise<EngineerSupervisorFile | undefined> {
    const supervisor = readSupervisor(options.supervisorId);
    if (!supervisor) {
      return undefined;
    }
    const worker = findWorker(supervisor, options);
    if (!worker) {
      throw new Error('找不到要 resume 的 supervisor worker');
    }
    const feedback = readText(options.feedback);
    if (!feedback) {
      throw new Error('feedback 不能为空');
    }
    if (!worker.taskId) {
      throw new Error('worker 还没有 task_id，不能 resume');
    }
    syncWorkerFromTask(worker);
    const task = readTask(worker.taskId);
    if (!task) {
      throw new Error('worker 还没有启动过 Codex task，不能 resume；请先等待依赖完成并运行 supervisor status。');
    }
    if (!task.codexSessionId) {
      throw new Error('worker task 尚未产生 codex_session_id，不能 resume；请先运行 supervisor status 同步。');
    }
    if (worker.status === 'running') {
      throw new Error('worker 仍在 running，不能并发 resume 同一个 Codex session。');
    }
    const runningCount = supervisor.workers.filter(candidate => {
      return candidate.workerId !== worker.workerId && candidate.status === 'running';
    }).length;
    if (runningCount >= supervisor.maxParallel) {
      throw new Error(`max_parallel=${supervisor.maxParallel} 已满，不能 resume worker ${worker.workerId}。`);
    }

    await this.runner.resume({
      taskId: worker.taskId,
      feedback,
      request: feedback,
      cwd: options.cwd || worker.cwd,
      allowEdits: options.allowEdits ?? worker.allowEdits,
      sandbox: options.sandbox || worker.sandbox,
      model: options.model || worker.model,
      timeoutMs: options.timeoutMs || worker.timeoutMs,
      validationCommands: options.validationCommands || worker.validationCommands,
      validationTimeoutMs: options.validationTimeoutMs || worker.validationTimeoutMs,
      skipGitRepoCheck: options.skipGitRepoCheck ?? worker.skipGitRepoCheck,
    });
    worker.status = 'running';
    worker.updatedAt = new Date().toISOString();
    worker.completedAt = undefined;
    worker.error = undefined;
    syncWorkerFromTask(worker);
    supervisor.status = 'running';
    supervisor.completedAt = undefined;
    supervisor.updatedAt = worker.updatedAt;
    persistSupervisor(supervisor);
    writeSupervisorAggregate(supervisor);
    return supervisor;
  }

  async cancel(options: EngineerSupervisorCancelOptions): Promise<EngineerSupervisorFile | undefined> {
    const supervisor = readSupervisor(options.supervisorId);
    if (!supervisor) {
      return undefined;
    }
    const workers = options.workerId
      ? supervisor.workers.filter(worker => worker.workerId === options.workerId || worker.taskId === options.workerId)
      : supervisor.workers;
    if (workers.length === 0) {
      throw new Error('找不到要取消的 supervisor worker');
    }

    const now = new Date().toISOString();
    for (const worker of workers) {
      if (worker.status === 'running') {
        await this.runner.cancel(worker.taskId);
        syncWorkerFromTask(worker);
      } else if (worker.status === 'queued' || worker.status === 'blocked') {
        worker.status = 'cancelled';
      }
      worker.completedAt = worker.completedAt || now;
      worker.updatedAt = now;
    }
    finalizeSupervisor(supervisor);
    persistSupervisor(supervisor);
    writeSupervisorAggregate(supervisor);
    return supervisor;
  }

  private async syncRunningWorkers(
    supervisor: EngineerSupervisorFile,
    options: EngineerSupervisorStatusOptions,
  ): Promise<void> {
    const running = supervisor.workers.filter(worker => worker.status === 'running');
    const perWorkerWaitMs = running.length > 0
      ? Math.floor((options.waitMs || 0) / running.length)
      : 0;
    for (const worker of running) {
      await this.runner.status({
        taskId: worker.taskId,
        waitMs: perWorkerWaitMs,
        pollIntervalMs: options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS,
        verbose: options.verbose === true,
      });
      syncWorkerFromTask(worker);
    }
  }

  private async startReadyWorkers(supervisor: EngineerSupervisorFile): Promise<void> {
    blockWorkersWithFailedDependencies(supervisor);
    let runningCount = supervisor.workers.filter(worker => worker.status === 'running').length;
    const ready = supervisor.workers
      .filter(worker => worker.status === 'queued' && dependenciesCompleted(supervisor, worker))
      .sort((a, b) => b.priority - a.priority);

    for (const worker of ready) {
      if (runningCount >= supervisor.maxParallel) {
        break;
      }
      try {
        const task = await this.runner.run({
          request: buildWorkerRequest(supervisor, worker),
          taskId: worker.taskId,
          cwd: worker.cwd,
          codexSessionId: worker.codexSessionId,
          timeoutMs: worker.timeoutMs,
          allowEdits: worker.allowEdits,
          sandbox: worker.sandbox,
          model: worker.model,
          validationCommands: worker.validationCommands,
          validationTimeoutMs: worker.validationTimeoutMs,
          skipGitRepoCheck: worker.skipGitRepoCheck,
        });
        worker.status = 'running';
        worker.startedAt = new Date().toISOString();
        worker.updatedAt = worker.startedAt;
        runningCount += 1;
        worker.codexJobId = task.codexJobId;
        worker.lastCodexSessionId = task.codexSessionId;
        worker.artifacts = {
          task: task.artifacts.task,
          plan: task.artifacts.plan,
          validation: task.artifacts.validation,
          finalSummary: task.artifacts.finalSummary,
        };
      } catch (error: any) {
        worker.status = 'failed';
        worker.error = String(error?.message || error);
        worker.completedAt = new Date().toISOString();
        worker.updatedAt = worker.completedAt;
      }
    }
  }
}

export function readSupervisor(supervisorId: string): EngineerSupervisorFile | undefined {
  const filePath = buildSupervisorPaths(safeSegment(supervisorId)).supervisor;
  try {
    return hydrateSupervisor(JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EngineerSupervisorFile);
  } catch {
    return undefined;
  }
}

export function formatSupervisor(supervisor: EngineerSupervisorFile): string {
  const counts = countWorkerStatuses(supervisor);
  const lines = [
    `engineer_codex_supervisor: status=${supervisor.status}`,
    `supervisor_id=${supervisor.supervisorId}`,
    `goal=${supervisor.goal}`,
    `cwd=${supervisor.cwd}`,
    `max_parallel=${supervisor.maxParallel}`,
    `workers=${supervisor.workers.length}`,
    `running=${counts.running}`,
    `queued=${counts.queued}`,
    `completed=${counts.completed}`,
    `failed=${counts.failed}`,
    `blocked=${counts.blocked}`,
    `cancelled=${counts.cancelled}`,
    `supervisor_file=${supervisor.artifacts.supervisor}`,
    `plan=${supervisor.artifacts.plan}`,
    `aggregate=${supervisor.artifacts.aggregate}`,
    '',
    '## Workers',
  ];
  for (const worker of supervisor.workers) {
    lines.push(
      [
        `- worker_id=${worker.workerId}`,
        `status=${worker.status}`,
        `task_id=${worker.taskId}`,
        worker.codexJobId ? `codex_job_id=${worker.codexJobId}` : '',
        worker.lastCodexSessionId ? `codex_session_id=${worker.lastCodexSessionId}` : '',
        worker.validationStatus ? `validation_status=${worker.validationStatus}` : '',
        worker.dependsOn.length ? `depends_on=${worker.dependsOn.join(',')}` : '',
        worker.error ? `error=${worker.error}` : '',
      ].filter(Boolean).join(' '),
    );
  }
  return lines.join('\n');
}

function createWorker(input: {
  input: EngineerSupervisorWorkerInput;
  index: number;
  supervisorId: string;
  workerId: string;
  cwd: string;
  now: string;
}): EngineerSupervisorWorker {
  const request = readText(input.input.request);
  if (!request) {
    throw new Error(`worker ${input.index + 1} request 不能为空`);
  }
  return {
    workerId: input.workerId,
    label: readText(input.input.label) || input.workerId,
    request,
    cwd: input.cwd,
    codexSessionId: readText(input.input.codexSessionId) || undefined,
    dependsOn: normalizeDependsOn(input.input.dependsOn),
    priority: Number.isFinite(Number(input.input.priority)) ? Number(input.input.priority) : 0,
    status: 'queued',
    taskId: safeSegment(`${input.supervisorId}-${input.workerId}`),
    allowEdits: input.input.allowEdits !== false,
    sandbox: readText(input.input.sandbox) || undefined,
    model: readText(input.input.model) || undefined,
    timeoutMs: positiveNumber(input.input.timeoutMs),
    validationCommands: normalizeStringArray(input.input.validationCommands),
    validationTimeoutMs: positiveNumber(input.input.validationTimeoutMs),
    skipGitRepoCheck: input.input.skipGitRepoCheck === true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function buildSupervisorPaths(supervisorId: string): EngineerSupervisorFile['artifacts'] {
  const dir = path.join(getSupervisorRoot(), safeSegment(supervisorId));
  return {
    dir,
    supervisor: path.join(dir, 'supervisor.json'),
    plan: path.join(dir, 'plan.md'),
    aggregate: path.join(dir, 'aggregate.md'),
  };
}

function getSupervisorRoot(): string {
  return path.resolve('data', 'engineer-supervisors');
}

function hydrateSupervisor(supervisor: EngineerSupervisorFile): EngineerSupervisorFile {
  const paths = buildSupervisorPaths(supervisor.supervisorId);
  supervisor.artifacts = { ...paths, ...supervisor.artifacts };
  supervisor.workers = Array.isArray(supervisor.workers) ? supervisor.workers : [];
  return supervisor;
}

function ensureFreshDir(dir: string): void {
  if (fs.existsSync(dir)) {
    throw new Error(`Engineer supervisor directory already exists: ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
}

function persistSupervisor(supervisor: EngineerSupervisorFile): void {
  fs.mkdirSync(supervisor.artifacts.dir, { recursive: true });
  supervisor.updatedAt = new Date().toISOString();
  fs.writeFileSync(supervisor.artifacts.supervisor, JSON.stringify(supervisor, null, 2), 'utf-8');
}

function writeSupervisorPlan(supervisor: EngineerSupervisorFile): void {
  const lines = [
    `# Engineer Codex Supervisor ${supervisor.supervisorId}`,
    '',
    `- status: ${supervisor.status}`,
    `- goal: ${supervisor.goal}`,
    `- cwd: ${supervisor.cwd}`,
    `- max_parallel: ${supervisor.maxParallel}`,
    '',
    '## Workers',
    '',
  ];
  for (const worker of supervisor.workers) {
    lines.push(
      `### ${worker.workerId}`,
      '',
      `- label: ${worker.label}`,
      `- status: ${worker.status}`,
      `- task_id: ${worker.taskId}`,
      `- cwd: ${worker.cwd}`,
      `- depends_on: ${worker.dependsOn.join(', ') || 'none'}`,
      `- allow_edits: ${String(worker.allowEdits)}`,
      '',
      worker.request,
      '',
    );
  }
  fs.writeFileSync(supervisor.artifacts.plan, lines.join('\n'), 'utf-8');
}

function writeSupervisorAggregate(supervisor: EngineerSupervisorFile): void {
  const counts = countWorkerStatuses(supervisor);
  const lines = [
    `# Engineer Codex Supervisor Aggregate ${supervisor.supervisorId}`,
    '',
    `- status: ${supervisor.status}`,
    `- goal: ${supervisor.goal}`,
    `- workers_total: ${supervisor.workers.length}`,
    `- running: ${counts.running}`,
    `- queued: ${counts.queued}`,
    `- completed: ${counts.completed}`,
    `- failed: ${counts.failed}`,
    `- blocked: ${counts.blocked}`,
    `- cancelled: ${counts.cancelled}`,
    '',
    '## Worker Evidence',
    '',
  ];
  for (const worker of supervisor.workers) {
    lines.push(
      `### ${worker.workerId} - ${worker.status}`,
      '',
      `- label: ${worker.label}`,
      `- task_id: ${worker.taskId}`,
      `- cwd: ${worker.cwd}`,
      `- codex_job_id: ${worker.codexJobId || ''}`,
      `- codex_session_id: ${worker.lastCodexSessionId || ''}`,
      `- validation_status: ${worker.validationStatus || ''}`,
      `- depends_on: ${worker.dependsOn.join(', ') || 'none'}`,
      `- task_file: ${worker.artifacts?.task || ''}`,
      `- validation: ${worker.artifacts?.validation || ''}`,
      `- final_summary: ${worker.artifacts?.finalSummary || ''}`,
      worker.error ? `- error: ${worker.error}` : '',
      '',
      worker.lastMessage || '',
      '',
    );
  }
  lines.push(
    '## Review Handoff',
    '',
    supervisor.status === 'completed'
      ? 'All supervisor workers completed. EngineerCat should hand aggregate.md, worker validation.md files, and final-summary.md files to ReviewerCat or the user for independent acceptance.'
      : 'Supervisor is not fully completed. Do not claim release approval; inspect failed, blocked, queued, or running workers first.',
  );
  fs.writeFileSync(supervisor.artifacts.aggregate, lines.filter(line => line !== undefined).join('\n'), 'utf-8');
}

function finalizeSupervisor(supervisor: EngineerSupervisorFile): void {
  const workers = supervisor.workers;
  if (workers.length === 0) {
    supervisor.status = 'blocked';
    return;
  }
  if (workers.some(worker => worker.status === 'running' || worker.status === 'queued')) {
    supervisor.status = 'running';
    supervisor.completedAt = undefined;
    return;
  }
  if (workers.every(worker => worker.status === 'completed')) {
    supervisor.status = 'completed';
  } else if (workers.some(worker => worker.status === 'failed')) {
    supervisor.status = 'failed';
  } else if (workers.some(worker => worker.status === 'blocked')) {
    supervisor.status = 'blocked';
  } else {
    supervisor.status = 'cancelled';
  }
  supervisor.completedAt = supervisor.completedAt || new Date().toISOString();
}

function blockWorkersWithFailedDependencies(supervisor: EngineerSupervisorFile): void {
  for (const worker of supervisor.workers) {
    if (worker.status !== 'queued') {
      continue;
    }
    const blocker = findDependencyBlocker(supervisor, worker);
    if (blocker) {
      worker.status = 'blocked';
      worker.error = blocker.status
        ? `Dependency ${blocker.workerId} ended as ${blocker.status}.`
        : `Dependency ${blocker.workerId} was not found.`;
      worker.completedAt = new Date().toISOString();
      worker.updatedAt = worker.completedAt;
    }
  }
}

function findDependencyBlocker(
  supervisor: EngineerSupervisorFile,
  worker: EngineerSupervisorWorker,
): { workerId: string; status?: EngineerSupervisorWorkerStatus } | undefined {
  for (const dependencyId of worker.dependsOn) {
    const dependency = supervisor.workers.find(candidate => candidate.workerId === dependencyId);
    if (!dependency) {
      return { workerId: dependencyId };
    }
    if (
      dependency.status === 'failed'
      || dependency.status === 'blocked'
      || dependency.status === 'cancelled'
    ) {
      return { workerId: dependency.workerId, status: dependency.status };
    }
  }
  return undefined;
}

function dependenciesCompleted(supervisor: EngineerSupervisorFile, worker: EngineerSupervisorWorker): boolean {
  return worker.dependsOn.every(id => {
    const dependency = supervisor.workers.find(candidate => candidate.workerId === id);
    return dependency?.status === 'completed';
  });
}

function syncWorkerFromTask(worker: EngineerSupervisorWorker): void {
  const task = readTask(worker.taskId);
  if (!task) {
    return;
  }
  worker.status = mapTaskStatus(task.status);
  worker.codexJobId = task.codexJobId;
  worker.lastCodexSessionId = task.codexSessionId || worker.lastCodexSessionId;
  worker.validationStatus = task.validation?.status;
  worker.lastMessage = task.lastMessage;
  worker.error = task.error;
  worker.completedAt = task.completedAt;
  worker.updatedAt = task.updatedAt;
  worker.artifacts = {
    task: task.artifacts.task,
    plan: task.artifacts.plan,
    validation: task.artifacts.validation,
    finalSummary: task.artifacts.finalSummary,
  };
}

function mapTaskStatus(status: EngineerTaskStatus): EngineerSupervisorWorkerStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'cancelled') return 'cancelled';
  return 'running';
}

function findWorker(
  supervisor: EngineerSupervisorFile,
  options: Pick<EngineerSupervisorResumeOptions, 'workerId' | 'taskId'>,
): EngineerSupervisorWorker | undefined {
  return supervisor.workers.find(worker => {
    return (options.workerId && worker.workerId === options.workerId)
      || (options.taskId && worker.taskId === options.taskId);
  });
}

function buildWorkerRequest(supervisor: EngineerSupervisorFile, worker: EngineerSupervisorWorker): string {
  return [
    `Supervisor: ${supervisor.supervisorId}`,
    `Supervisor goal: ${supervisor.goal}`,
    `Worker: ${worker.workerId} (${worker.label})`,
    `Dependencies: ${worker.dependsOn.join(', ') || 'none'}`,
    '',
    'Worker task:',
    worker.request,
    '',
    'Required handoff:',
    '- State what changed or what was found.',
    '- Preserve artifacts and validation evidence.',
    '- Do not self-close; leave acceptance to ReviewerCat or the user.',
  ].join('\n');
}

function countWorkerStatuses(supervisor: EngineerSupervisorFile): Record<EngineerSupervisorWorkerStatus, number> {
  const counts: Record<EngineerSupervisorWorkerStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
  };
  for (const worker of supervisor.workers) {
    counts[worker.status] += 1;
  }
  return counts;
}

function normalizeMaxParallel(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_PARALLEL;
  }
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(item => safeSegment(String(item || ''))).filter(Boolean);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value.map(item => readText(item)).filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readText(value: unknown): string {
  return String(value || '').trim();
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function uniqueWorkerId(value: string, seen: Set<string>): string {
  const base = safeSegment(value) || 'worker';
  let candidate = base;
  let index = 2;
  while (seen.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  seen.add(candidate);
  return candidate;
}

function createSupervisorId(): string {
  return `eng-supervisor-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}
