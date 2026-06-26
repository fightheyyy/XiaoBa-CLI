import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync, spawn } from 'child_process';
import { ToolExecutionContext } from '../../../types/tool';
import {
  CodexJobCancelTool,
  CodexJobResumeTool,
  CodexJobStartTool,
  CodexJobStatusTool,
} from '../../reviewer-cat/tools/codex-job-tools';
import {
  EngineerValidationSource,
  normalizeValidationCommands,
  planChangedFileValidation,
  planEngineerValidation,
} from './engineer-quality-gates';

export type EngineerTaskStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
export type EngineerTaskRoute = 'codex_start' | 'codex_resume';
export type EngineerTaskValidationStatus = 'not_configured' | 'pending' | 'running' | 'passed' | 'failed';

export interface EngineerTaskValidationResult {
  command: string;
  exitCode: number | null;
  signal?: string | null;
  durationMs: number;
  stdoutPreview: string;
  stderrPreview: string;
}

export interface EngineerTaskValidation {
  status: EngineerTaskValidationStatus;
  commands: string[];
  source: EngineerValidationSource;
  reasons: string[];
  timeoutMs: number;
  codexJobId?: string;
  startedAt?: string;
  completedAt?: string;
  results: EngineerTaskValidationResult[];
  summary?: string;
}

export interface EngineerTaskFile {
  version: 1;
  taskId: string;
  status: EngineerTaskStatus;
  route: EngineerTaskRoute;
  cwd: string;
  request: string;
  allowEdits?: boolean;
  sandbox?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  codexJobId?: string;
  codexSessionId?: string;
  resumeFromTaskId?: string;
  resumeFromCodexSessionId?: string;
  lastStatusOutput?: string;
  lastMessage?: string;
  error?: string;
  validation?: EngineerTaskValidation;
  artifacts: {
    dir: string;
    task: string;
    plan: string;
    validation: string;
    finalSummary: string;
  };
}

export interface EngineerTaskRunOptions {
  request: string;
  taskId?: string;
  cwd: string;
  codexSessionId?: string;
  parentTaskId?: string;
  timeoutMs?: number;
  allowEdits: boolean;
  sandbox?: string;
  model?: string;
  validationCommands?: string[];
  validationTimeoutMs?: number;
  skipGitRepoCheck: boolean;
}

export interface EngineerTaskStatusOptions {
  taskId: string;
  waitMs: number;
  pollIntervalMs: number;
  verbose: boolean;
}

export interface EngineerTaskResumeOptions extends Omit<EngineerTaskRunOptions, 'codexSessionId' | 'parentTaskId'> {
  taskId: string;
  feedback: string;
}

export interface CodexTaskAdapter {
  start(options: EngineerTaskRunOptions): Promise<CodexTaskStartResult>;
  resume(options: EngineerTaskRunOptions & { codexSessionId: string }): Promise<CodexTaskStartResult>;
  status(options: {
    jobId: string;
    waitMs: number;
    pollIntervalMs: number;
    verbose: boolean;
  }): Promise<CodexTaskStatusResult>;
  cancel(jobId: string): Promise<string>;
}

export interface CodexTaskStartResult {
  jobId: string;
  sessionId?: string;
  raw: string;
}

export interface CodexTaskStatusResult {
  status?: string;
  sessionId?: string;
  lastMessage?: string;
  raw: string;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_VALIDATION_TIMEOUT_MS = 5 * 60 * 1000;
const VALIDATION_PREVIEW_CHARS = 6000;

export class EngineerTaskRunner {
  constructor(private codex: CodexTaskAdapter) {}

  async run(options: EngineerTaskRunOptions): Promise<EngineerTaskFile> {
    const request = readText(options.request);
    if (!request) {
      throw new Error('request 不能为空');
    }

    const taskId = options.taskId ? safeSegment(options.taskId) : createTaskId('eng');
    const paths = buildTaskPaths(taskId);
    ensureFreshDir(paths.dir);

    const task = createTaskFile({
      taskId,
      route: options.codexSessionId ? 'codex_resume' : 'codex_start',
      cwd: options.cwd,
      request,
      allowEdits: options.allowEdits,
      sandbox: options.sandbox || (options.allowEdits ? 'workspace-write' : 'read-only'),
      paths,
      resumeFromTaskId: options.parentTaskId,
      resumeFromCodexSessionId: options.codexSessionId,
      validation: createValidation({
        commands: options.validationCommands,
        timeoutMs: options.validationTimeoutMs,
        cwd: options.cwd,
        request,
        allowEdits: options.allowEdits,
      }),
    });
    persistTask(task);
    writePlan(task, options);

    try {
      const result = options.codexSessionId
        ? await this.codex.resume({ ...options, codexSessionId: options.codexSessionId })
        : await this.codex.start(options);
      task.codexJobId = result.jobId;
      task.codexSessionId = result.sessionId || options.codexSessionId;
      task.lastStatusOutput = result.raw;
      task.updatedAt = new Date().toISOString();
      persistTask(task);
      return task;
    } catch (error: any) {
      task.status = 'failed';
      task.error = String(error?.message || error);
      task.completedAt = new Date().toISOString();
      task.updatedAt = task.completedAt;
      persistTask(task);
      writeFinalSummary(task);
      throw error;
    }
  }

  async status(options: EngineerTaskStatusOptions): Promise<string> {
    const task = readTask(options.taskId);
    if (!task) {
      return `错误：找不到 engineer task: ${options.taskId}`;
    }
    if (!task.codexJobId) {
      return formatTaskStatus(task, 'Codex job 尚未创建。');
    }

    const codexStatus = await this.codex.status({
      jobId: task.codexJobId,
      waitMs: options.waitMs,
      pollIntervalMs: options.pollIntervalMs,
      verbose: options.verbose,
    });

    task.codexSessionId = codexStatus.sessionId || task.codexSessionId;
    task.lastMessage = codexStatus.lastMessage || task.lastMessage;
    task.lastStatusOutput = codexStatus.raw;
    const mapped = mapCodexStatus(codexStatus.status);
    if (mapped && mapped !== task.status) {
      task.status = mapped;
    }
    if (task.status === 'completed') {
      await ensureValidation(task);
    }
    if (task.status !== 'running') {
      task.completedAt = task.completedAt || new Date().toISOString();
      writeFinalSummary(task);
    }
    task.updatedAt = new Date().toISOString();
    persistTask(task);

    return formatTaskStatus(task, codexStatus.raw);
  }

  async resume(options: EngineerTaskResumeOptions): Promise<string> {
    const task = readTask(options.taskId);
    if (!task) {
      return `错误：找不到 engineer task: ${options.taskId}`;
    }

    const feedback = readText(options.feedback);
    if (!feedback) {
      return '错误：feedback 不能为空';
    }
    const sessionId = task.codexSessionId;
    if (!sessionId) {
      return '错误：当前 task 还没有 codex_session_id，请先 engineer_task_status 查看 Codex 是否已经产生 session。';
    }

    const result = await this.codex.resume({
      ...options,
      request: feedback,
      cwd: options.cwd || task.cwd,
      codexSessionId: sessionId,
      parentTaskId: task.taskId,
    });

    task.status = 'running';
    task.route = 'codex_resume';
    task.request = `${task.request}\n\n[resume feedback]\n${feedback}`;
    task.allowEdits = options.allowEdits;
    task.sandbox = options.sandbox || task.sandbox || (options.allowEdits ? 'workspace-write' : 'read-only');
    task.codexJobId = result.jobId;
    task.codexSessionId = result.sessionId || sessionId;
    task.resumeFromCodexSessionId = sessionId;
    task.lastStatusOutput = result.raw;
    task.validation = resetValidationForResume(task, options);
    task.updatedAt = new Date().toISOString();
    task.completedAt = undefined;
    task.error = undefined;
    persistTask(task);
    appendPlan(task, feedback);

    return [
      `engineer_task: running=true status=${task.status}`,
      `task_id=${task.taskId}`,
      `codex_job_id=${task.codexJobId}`,
      `codex_session_id=${task.codexSessionId}`,
    ].join('\n');
  }

  async cancel(taskId: string): Promise<string> {
    const task = readTask(taskId);
    if (!task) {
      return `错误：找不到 engineer task: ${taskId}`;
    }
    if (!task.codexJobId) {
      task.status = 'cancelled';
      task.completedAt = new Date().toISOString();
      task.updatedAt = task.completedAt;
      persistTask(task);
      return `engineer_task_cancel: task_id=${task.taskId} 尚未创建 Codex job，已标记 cancelled`;
    }

    const result = await this.codex.cancel(task.codexJobId);
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    task.updatedAt = task.completedAt;
    task.lastStatusOutput = result;
    persistTask(task);
    writeFinalSummary(task);
    return `engineer_task_cancel: task_id=${task.taskId}\n${result}`;
  }
}

export class ToolCodexTaskAdapter implements CodexTaskAdapter {
  constructor(private context: ToolExecutionContext) {}

  async start(options: EngineerTaskRunOptions): Promise<CodexTaskStartResult> {
    const output = await new CodexJobStartTool().execute({
      message: options.request,
      cwd: options.cwd,
      timeout_ms: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      allow_edits: options.allowEdits,
      sandbox: options.sandbox,
      model: options.model,
      skip_git_repo_check: options.skipGitRepoCheck,
    }, this.context);
    return parseCodexStartResult(String(output));
  }

  async resume(options: EngineerTaskRunOptions & { codexSessionId: string }): Promise<CodexTaskStartResult> {
    const output = await new CodexJobResumeTool().execute({
      message: options.request,
      codex_session_id: options.codexSessionId,
      cwd: options.cwd,
      timeout_ms: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      allow_edits: options.allowEdits,
      sandbox: options.sandbox,
      model: options.model,
      skip_git_repo_check: options.skipGitRepoCheck,
    }, this.context);
    return parseCodexStartResult(String(output));
  }

  async status(options: {
    jobId: string;
    waitMs: number;
    pollIntervalMs: number;
    verbose: boolean;
  }): Promise<CodexTaskStatusResult> {
    const output = await new CodexJobStatusTool().execute({
      job_id: options.jobId,
      wait_ms: options.waitMs,
      poll_interval_ms: options.pollIntervalMs,
      verbose: options.verbose,
    }, this.context);
    return parseCodexStatusResult(String(output));
  }

  async cancel(jobId: string): Promise<string> {
    return String(await new CodexJobCancelTool().execute({ job_id: jobId }, this.context));
  }
}

function createTaskFile(input: {
  taskId: string;
  route: EngineerTaskRoute;
  cwd: string;
  request: string;
  allowEdits: boolean;
  sandbox?: string;
  paths: EngineerTaskFile['artifacts'];
  resumeFromTaskId?: string;
  resumeFromCodexSessionId?: string;
  validation: EngineerTaskValidation;
}): EngineerTaskFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    taskId: input.taskId,
    status: 'running',
    route: input.route,
    cwd: input.cwd,
    request: input.request,
    allowEdits: input.allowEdits,
    sandbox: input.sandbox,
    createdAt: now,
    updatedAt: now,
    resumeFromTaskId: input.resumeFromTaskId,
    resumeFromCodexSessionId: input.resumeFromCodexSessionId,
    validation: input.validation,
    artifacts: input.paths,
  };
}

function buildTaskPaths(taskId: string): EngineerTaskFile['artifacts'] {
  const dir = path.join(getEngineerTaskRoot(), safeSegment(taskId));
  return {
    dir,
    task: path.join(dir, 'task.json'),
    plan: path.join(dir, 'plan.md'),
    validation: path.join(dir, 'validation.md'),
    finalSummary: path.join(dir, 'final-summary.md'),
  };
}

function getEngineerTaskRoot(): string {
  return path.resolve('data', 'engineer-tasks');
}

function ensureFreshDir(dir: string): void {
  if (fs.existsSync(dir)) {
    throw new Error(`Engineer task directory already exists: ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
}

function persistTask(task: EngineerTaskFile): void {
  fs.mkdirSync(task.artifacts.dir, { recursive: true });
  fs.writeFileSync(task.artifacts.task, JSON.stringify(task, null, 2), 'utf-8');
}

export function readTask(taskId: string): EngineerTaskFile | undefined {
  const filePath = buildTaskPaths(safeSegment(taskId)).task;
  try {
    return hydrateTask(JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EngineerTaskFile);
  } catch {
    return undefined;
  }
}

function hydrateTask(task: EngineerTaskFile): EngineerTaskFile {
  const paths = buildTaskPaths(task.taskId);
  task.artifacts = {
    ...paths,
    ...task.artifacts,
    validation: task.artifacts.validation || paths.validation,
  };
  if (!task.validation) {
    task.validation = createEmptyValidation(DEFAULT_VALIDATION_TIMEOUT_MS);
  }
  task.validation.source = task.validation.source || (task.validation.commands.length > 0 ? 'explicit' : 'not_configured');
  task.validation.reasons = Array.isArray(task.validation.reasons) ? task.validation.reasons : [];
  return task;
}

function createValidation(input: {
  commands: unknown;
  timeoutMs?: number;
  cwd: string;
  request: string;
  allowEdits: boolean;
}): EngineerTaskValidation {
  const plan = planEngineerValidation({
    cwd: input.cwd,
    request: input.request,
    explicitCommands: input.commands,
    allowEdits: input.allowEdits,
  });
  return {
    status: plan.commands.length > 0 ? 'pending' : 'not_configured',
    commands: plan.commands,
    source: plan.source,
    reasons: plan.reasons,
    timeoutMs: readPositiveNumber(input.timeoutMs, DEFAULT_VALIDATION_TIMEOUT_MS),
    results: [],
  };
}

function createEmptyValidation(timeoutMs: number): EngineerTaskValidation {
  return {
    status: 'not_configured',
    commands: [],
    source: 'not_configured',
    reasons: [],
    timeoutMs,
    results: [],
  };
}

function resetValidationForResume(
  task: EngineerTaskFile,
  options: EngineerTaskRunOptions,
): EngineerTaskValidation {
  const explicit = normalizeValidationCommands(options.validationCommands);
  const previous = task.validation?.commands || [];
  const commands = explicit.length > 0 ? explicit : previous;
  if (commands.length === 0) {
    return createValidation({
      commands: [],
      timeoutMs: options.validationTimeoutMs,
      cwd: options.cwd || task.cwd,
      request: options.request,
      allowEdits: options.allowEdits,
    });
  }
  return {
    status: commands.length > 0 ? 'pending' : 'not_configured',
    commands,
    source: explicit.length > 0 ? 'explicit' : (task.validation?.source || 'inferred'),
    reasons: explicit.length > 0 ? ['Caller provided explicit validation_commands for this resume.'] : (task.validation?.reasons || ['Inherited validation commands from the previous task run.']),
    timeoutMs: readPositiveNumber(options.validationTimeoutMs, task.validation?.timeoutMs || DEFAULT_VALIDATION_TIMEOUT_MS),
    results: [],
  };
}

async function ensureValidation(task: EngineerTaskFile): Promise<void> {
  task.validation = task.validation || createEmptyValidation(DEFAULT_VALIDATION_TIMEOUT_MS);
  applyChangeAwareValidationGates(task);
  if (task.validation.commands.length === 0) {
    task.validation.status = 'not_configured';
    task.validation.codexJobId = task.codexJobId;
    task.validation.summary = 'No validation commands configured for this engineer task.';
    writeValidation(task);
    return;
  }

  if (
    (task.validation.status === 'passed' || task.validation.status === 'failed')
    && task.validation.codexJobId === task.codexJobId
  ) {
    return;
  }

  task.validation.status = 'running';
  task.validation.codexJobId = task.codexJobId;
  task.validation.startedAt = new Date().toISOString();
  task.validation.completedAt = undefined;
  task.validation.results = [];
  task.validation.summary = undefined;
  persistTask(task);
  writeValidation(task);

  const results: EngineerTaskValidationResult[] = [];
  for (const command of task.validation.commands) {
    results.push(await runValidationCommand(command, task.cwd, task.validation.timeoutMs));
  }

  const failed = results.find(result => result.exitCode !== 0);
  task.validation.results = results;
  task.validation.status = failed ? 'failed' : 'passed';
  task.validation.completedAt = new Date().toISOString();
  task.validation.summary = failed
    ? `Validation failed: ${failed.command}`
    : 'All validation commands passed.';
  if (failed) {
    task.status = 'failed';
    task.error = 'validation_failed';
  }
  writeValidation(task);
}

function applyChangeAwareValidationGates(task: EngineerTaskFile): void {
  if (process.env.XIAOBA_ENGINEER_DISABLE_CHANGE_AWARE_GATES === '1') {
    return;
  }
  if (task.allowEdits === false) {
    return;
  }
  if (!isGitRepository(task.cwd)) {
    return;
  }
  const changedFiles = listChangedFiles(task.cwd).filter(file => !isRunnerTraceFile(file));
  if (changedFiles.length === 0) {
    return;
  }
  const validation = task.validation;
  if (!validation) {
    return;
  }
  const targetedPlan = planChangedFileValidation({
    cwd: task.cwd,
    changedFiles,
    existingCommands: validation.commands,
  });
  for (let index = 0; index < targetedPlan.commands.length; index++) {
    validation.commands.push(targetedPlan.commands[index]);
    validation.reasons.push(targetedPlan.reasons[index] || 'Changed-file-aware validation gate inferred by EngineerTaskRunner.');
  }
  const command = 'git diff --check && git diff --cached --check';
  if (validation.commands.includes(command)) {
    return;
  }
  validation.commands.push(command);
  validation.source = validation.source === 'not_configured' ? 'inferred' : validation.source;
  validation.status = 'pending';
  validation.reasons.push(
    `Detected ${changedFiles.length} changed file(s), so git diff whitespace/conflict-marker check is required before delivery.`,
  );
}

function isGitRepository(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function listChangedFiles(cwd: string): string[] {
  const files = new Set<string>();
  for (const args of [
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    try {
      const output = execFileSync('git', args, {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of output.split(/\r?\n/)) {
        const file = line.trim();
        if (file) {
          files.add(file);
        }
      }
    } catch {
      // Ignore git probing failures; validation commands will surface real issues.
    }
  }
  return Array.from(files);
}

function isRunnerTraceFile(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return normalized.startsWith('data/engineer-tasks/')
    || normalized.startsWith('data/codex-jobs/')
    || normalized.startsWith('data/sessions/');
}

function runValidationCommand(command: string, cwd: string, timeoutMs: number): Promise<EngineerTaskValidationResult> {
  return new Promise(resolve => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      stderr += `\n[validation timeout after ${timeoutMs}ms]`;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout = truncate(stdout + chunk.toString('utf-8'), VALIDATION_PREVIEW_CHARS);
    });
    child.stderr?.on('data', chunk => {
      stderr = truncate(stderr + chunk.toString('utf-8'), VALIDATION_PREVIEW_CHARS);
    });
    child.on('error', error => {
      stderr = truncate(`${stderr}\n${String(error.message || error)}`, VALIDATION_PREVIEW_CHARS);
    });
    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        exitCode: code ?? (signal ? 1 : null),
        signal,
        durationMs: Date.now() - started,
        stdoutPreview: truncate(stdout, VALIDATION_PREVIEW_CHARS),
        stderrPreview: truncate(stderr, VALIDATION_PREVIEW_CHARS),
      });
    });
  });
}

function writePlan(task: EngineerTaskFile, options: EngineerTaskRunOptions): void {
  const lines = [
    `# Engineer Task ${task.taskId}`,
    '',
    `- status: ${task.status}`,
    `- route: ${task.route}`,
    `- cwd: ${task.cwd}`,
    `- allow_edits: ${String(task.allowEdits ?? options.allowEdits)}`,
    `- sandbox: ${task.sandbox || options.sandbox || (options.allowEdits ? 'workspace-write' : 'read-only')}`,
    `- validation_source: ${task.validation?.source || 'not_configured'}`,
    '',
    '## Request',
    '',
    task.request,
    '',
    '## Execution',
    '',
    task.route === 'codex_resume'
      ? `Resume Codex session: ${options.codexSessionId}`
      : 'Start a new Codex session for this project.',
    '',
    '## Validation',
    '',
    task.validation?.commands.length
      ? task.validation.commands.map(command => `- ${command}`).join('\n')
      : '- No validation commands configured.',
    '',
    '## Validation Reasons',
    '',
    task.validation?.reasons?.length
      ? task.validation.reasons.map(reason => `- ${reason}`).join('\n')
      : '- No validation inference reason recorded.',
  ];
  fs.writeFileSync(task.artifacts.plan, lines.join('\n'), 'utf-8');
}

function appendPlan(task: EngineerTaskFile, feedback: string): void {
  fs.appendFileSync(
    task.artifacts.plan,
    [
      '',
      '## Resume Feedback',
      '',
      feedback,
      '',
      `- resumed_at: ${new Date().toISOString()}`,
      `- codex_session_id: ${task.codexSessionId || ''}`,
      `- codex_job_id: ${task.codexJobId || ''}`,
    ].join('\n'),
    'utf-8',
  );
}

function writeFinalSummary(task: EngineerTaskFile): void {
  const lines = [
    `# Engineer Task Summary ${task.taskId}`,
    '',
    `- status: ${task.status}`,
    `- route: ${task.route}`,
    `- cwd: ${task.cwd}`,
    `- allow_edits: ${String(task.allowEdits ?? '')}`,
    `- sandbox: ${task.sandbox || ''}`,
    `- codex_job_id: ${task.codexJobId || ''}`,
    `- codex_session_id: ${task.codexSessionId || ''}`,
    `- validation_status: ${task.validation?.status || 'not_configured'}`,
    `- validation_source: ${task.validation?.source || 'not_configured'}`,
    `- completed_at: ${task.completedAt || ''}`,
    '',
    '## Last Message',
    '',
    task.lastMessage || '',
    '',
    '## Last Status Output',
    '',
    task.lastStatusOutput || '',
    '',
    '## Validation',
    '',
    fs.existsSync(task.artifacts.validation)
      ? `See: ${task.artifacts.validation}`
      : task.validation?.summary || '',
    '',
    '## Validation Rationale',
    '',
    task.validation?.reasons?.length
      ? task.validation.reasons.map(reason => `- ${reason}`).join('\n')
      : '- No validation rationale recorded.',
    '',
    '## Review Handoff',
    '',
    reviewHandoffSummary(task),
    '',
    task.error ? `## Error\n\n${task.error}\n` : '',
  ];
  fs.writeFileSync(task.artifacts.finalSummary, lines.join('\n'), 'utf-8');
}

function writeValidation(task: EngineerTaskFile): void {
  const validation = task.validation || createEmptyValidation(DEFAULT_VALIDATION_TIMEOUT_MS);
  const lines = [
    `# Engineer Task Validation ${task.taskId}`,
    '',
    `- status: ${validation.status}`,
    `- source: ${validation.source || 'not_configured'}`,
    `- cwd: ${task.cwd}`,
    `- allow_edits: ${String(task.allowEdits ?? '')}`,
    `- codex_job_id: ${validation.codexJobId || task.codexJobId || ''}`,
    `- timeout_ms: ${validation.timeoutMs}`,
    `- started_at: ${validation.startedAt || ''}`,
    `- completed_at: ${validation.completedAt || ''}`,
    '',
    '## Commands',
    '',
    validation.commands.length
      ? validation.commands.map(command => `- ${command}`).join('\n')
      : '- No validation commands configured.',
    '',
    '## Reasons',
    '',
    validation.reasons?.length
      ? validation.reasons.map(reason => `- ${reason}`).join('\n')
      : '- No validation inference reason recorded.',
    '',
    '## Summary',
    '',
    validation.summary || '',
  ];

  if (validation.results.length > 0) {
    lines.push('', '## Results', '');
    for (const result of validation.results) {
      lines.push(
        `### ${result.command}`,
        '',
        `- exit_code: ${result.exitCode ?? ''}`,
        `- signal: ${result.signal || ''}`,
        `- duration_ms: ${result.durationMs}`,
        '',
        '#### stdout',
        '',
        '```text',
        result.stdoutPreview || '',
        '```',
        '',
        '#### stderr',
        '',
        '```text',
        result.stderrPreview || '',
        '```',
        '',
      );
    }
  }

  fs.writeFileSync(task.artifacts.validation, lines.join('\n'), 'utf-8');
}

function formatTaskStatus(task: EngineerTaskFile, codexOutput: string): string {
  const lines = [
    `engineer_task: running=${task.status === 'running' ? 'true' : 'false'} status=${task.status}`,
    `task_id=${task.taskId}`,
    `cwd=${task.cwd}`,
  ];
  if (task.codexJobId) lines.push(`codex_job_id=${task.codexJobId}`);
  if (task.codexSessionId) lines.push(`codex_session_id=${task.codexSessionId}`);
  lines.push(`task_file=${task.artifacts.task}`);
  lines.push(`plan=${task.artifacts.plan}`);
  lines.push(`validation_status=${task.validation?.status || 'not_configured'}`);
  lines.push(`validation_source=${task.validation?.source || 'not_configured'}`);
  if (fs.existsSync(task.artifacts.validation)) {
    lines.push(`validation=${task.artifacts.validation}`);
  }
  if (fs.existsSync(task.artifacts.finalSummary)) {
    lines.push(`final_summary=${task.artifacts.finalSummary}`);
  }
  if (task.error) {
    lines.push(`error=${task.error}`);
  }
  if (codexOutput) {
    lines.push('');
    lines.push(codexOutput);
  }
  return lines.join('\n');
}

function reviewHandoffSummary(task: EngineerTaskFile): string {
  if (task.status === 'failed') {
    return 'Do not deliver as done. Resume the same Codex session with the validation failure or hand off the blocker with validation.md evidence.';
  }
  if (task.status === 'blocked') {
    return 'Blocked tasks require a clear blocked reason and cannot be closed by EngineerCat.';
  }
  if (task.validation?.status === 'passed') {
    return 'EngineerCat implementation evidence is ready for ReviewerCat or human review; EngineerCat must not self-close the case.';
  }
  if (task.validation?.status === 'not_configured') {
    return 'Validation is not configured. Treat this as residual risk before claiming production-ready delivery.';
  }
  return 'Check validation.md and final-summary.md before ReviewerCat or human review.';
}

function parseCodexStartResult(raw: string): CodexTaskStartResult {
  const jobId = matchLine(raw, /job_id=([^\s]+)/);
  if (!jobId) {
    throw new Error(raw || 'Codex job did not return job_id');
  }
  return {
    jobId,
    sessionId: matchLine(raw, /session=([^\s]+)/),
    raw,
  };
}

function parseCodexStatusResult(raw: string): CodexTaskStatusResult {
  try {
    const payload = JSON.parse(raw);
    return {
      status: String(payload.status || ''),
      sessionId: payload.codex_session_id || undefined,
      lastMessage: payload.last_message || undefined,
      raw,
    };
  } catch {
    return {
      status: matchLine(raw, /status=([^\s]+)/),
      sessionId: matchLine(raw, /session=([^\s]+)/),
      lastMessage: matchLine(raw, /output=(.*)$/m),
      raw,
    };
  }
}

function mapCodexStatus(status: string | undefined): EngineerTaskStatus | undefined {
  if (!status) return undefined;
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'timeout' || status === 'spawn_error' || status === 'orphaned') {
    return 'failed';
  }
  return undefined;
}

function matchLine(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

function createTaskId(prefix: string): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `${prefix}-${ts}-${randomUUID().slice(0, 8)}`;
}

function readText(value: unknown): string {
  return String(value || '').trim();
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || '';
}
