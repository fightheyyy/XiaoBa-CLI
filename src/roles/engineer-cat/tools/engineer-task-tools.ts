import * as path from 'path';
import { ArtifactManifestItem, Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import {
  EngineerTaskRunner,
  ToolCodexTaskAdapter,
} from '../utils/engineer-task-runner';
import {
  EngineerCodexSupervisor,
  EngineerSupervisorWorkerInput,
  formatSupervisor,
} from '../utils/engineer-codex-supervisor';

const DEFAULT_STATUS_WAIT_MS = 0;
const DEFAULT_POLL_INTERVAL_MS = 5000;

export class EngineerTaskRunTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_task_run',
    description: [
      '创建 EngineerCat 工程任务并把实现交给本机 Codex CLI 后台执行。',
      '此工具立即返回 task_id；后续用 engineer_task_status 查询进度，用 engineer_task_resume 反馈返工。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: '完整工程需求，必须包含背景、目标、范围、约束、产物和验收口径。'
        },
        task_id: {
          type: 'string',
          description: '可选稳定 task id；不填自动生成。'
        },
        cwd: {
          type: 'string',
          description: '项目工作目录。默认当前工作目录。'
        },
        codex_session_id: {
          type: 'string',
          description: '可选；传入时直接 resume 指定 Codex session，否则启动新 Codex session。'
        },
        timeout_ms: {
          type: 'number',
          description: 'Codex job 超时时间，默认 1800000ms。'
        },
        allow_edits: {
          type: 'boolean',
          description: '是否允许 Codex 修改工作区。默认 true。'
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
        validation_commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Codex 完成后要在 cwd 中执行的验证命令列表，例如 npm run build 或目标测试。为空时 editable Node/TypeScript 项目会尝试推断基础 build/test gate。'
        },
        validation_timeout_ms: {
          type: 'number',
          description: '单条验证命令超时时间，默认 300000ms。'
        },
        skip_git_repo_check: {
          type: 'boolean',
          description: '是否允许在非 git 仓库运行。默认 false。'
        }
      },
      required: ['request']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const runner = createRunner(context);
    try {
      const task = await runner.run({
        request: readString(args.request),
        taskId: readOptionalString(args.task_id),
        cwd: resolveCwd(context.workingDirectory, args.cwd),
        codexSessionId: readOptionalString(args.codex_session_id),
        timeoutMs: readPositiveNumber(args.timeout_ms, 30 * 60 * 1000),
        allowEdits: args.allow_edits !== false,
        sandbox: readOptionalString(args.sandbox),
        model: readOptionalString(args.model),
        validationCommands: readStringArray(args.validation_commands),
        validationTimeoutMs: readPositiveNumber(args.validation_timeout_ms, 5 * 60 * 1000),
        skipGitRepoCheck: args.skip_git_repo_check === true,
      });

      return [
        `engineer_task: running=${task.status === 'running' ? 'true' : 'false'} status=${task.status}`,
        `task_id=${task.taskId}`,
        `route=${task.route}`,
        `cwd=${task.cwd}`,
        task.codexJobId ? `codex_job_id=${task.codexJobId}` : '',
        task.codexSessionId ? `codex_session_id=${task.codexSessionId}` : '',
        `task_file=${task.artifacts.task}`,
        `plan=${task.artifacts.plan}`,
      ].filter(Boolean).join('\n');
    } catch (error: any) {
      return `engineer_task_run 启动失败: ${String(error?.message || error)}`;
    }
  }

  getArtifactManifest(_args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    return artifactsFromKeys(result, ['task_file', 'plan'], 'created', context.workingDirectory);
  }
}

export class EngineerTaskStatusTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_task_status',
    description: '查询 EngineerCat 工程任务状态，并同步底层 Codex job 的最新输出。',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'engineer_task_run 返回的 task_id。'
        },
        wait_ms: {
          type: 'number',
          description: '如果任务仍在 running，最多等待多久再返回，默认 0。建议 30000。'
        },
        poll_interval_ms: {
          type: 'number',
          description: 'wait_ms 启用时的轮询间隔，默认 5000ms。'
        },
        verbose: {
          type: 'boolean',
          description: '是否透出底层 Codex verbose 状态。默认 false。'
        }
      },
      required: ['task_id']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const taskId = readString(args.task_id);
    if (!taskId) {
      return '错误：task_id 不能为空';
    }
    const runner = createRunner(context);
    return runner.status({
      taskId,
      waitMs: readNonNegativeNumber(args.wait_ms, DEFAULT_STATUS_WAIT_MS),
      pollIntervalMs: readPositiveNumber(args.poll_interval_ms, DEFAULT_POLL_INTERVAL_MS),
      verbose: args.verbose === true,
    });
  }

  getArtifactManifest(_args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    return artifactsFromKeys(result, ['task_file', 'plan', 'validation', 'final_summary'], 'captured', context.workingDirectory);
  }
}

export class EngineerTaskResumeTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_task_resume',
    description: '向已有 EngineerCat 工程任务追加反馈，继续 resume 同一个 Codex session 返工。',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'engineer_task_run 返回的 task_id。'
        },
        feedback: {
          type: 'string',
          description: '给 Codex 的新增反馈、失败信息、返工要求或补充需求。'
        },
        cwd: {
          type: 'string',
          description: '项目工作目录。默认继承 task cwd。'
        },
        timeout_ms: {
          type: 'number',
          description: 'Codex job 超时时间，默认 1800000ms。'
        },
        allow_edits: {
          type: 'boolean',
          description: '是否允许 Codex 修改工作区。默认 true。'
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
        validation_commands: {
          type: 'array',
          items: { type: 'string' },
          description: '本轮 resume 完成后要执行的验证命令；不填则继承原 task 的验证命令，若没有可继承命令则尝试推断基础 gate。'
        },
        validation_timeout_ms: {
          type: 'number',
          description: '单条验证命令超时时间，默认继承 task 或 300000ms。'
        },
        skip_git_repo_check: {
          type: 'boolean',
          description: '是否允许在非 git 仓库运行。默认 false。'
        }
      },
      required: ['task_id', 'feedback']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const taskId = readString(args.task_id);
    const feedback = readString(args.feedback);
    if (!taskId || !feedback) {
      return '错误：task_id 和 feedback 不能为空';
    }
    const runner = createRunner(context);
    return runner.resume({
      taskId,
      feedback,
      request: feedback,
      cwd: args.cwd ? resolveCwd(context.workingDirectory, args.cwd) : '',
      timeoutMs: readPositiveNumber(args.timeout_ms, 30 * 60 * 1000),
      allowEdits: args.allow_edits !== false,
      sandbox: readOptionalString(args.sandbox),
      model: readOptionalString(args.model),
      validationCommands: readStringArray(args.validation_commands),
      validationTimeoutMs: readOptionalPositiveNumber(args.validation_timeout_ms),
      skipGitRepoCheck: args.skip_git_repo_check === true,
    });
  }

  getArtifactManifest(args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    const taskId = keyValue(result, 'task_id') || readString(args.task_id);
    return engineerTaskArtifacts(taskId, ['task.json', 'plan.md'], 'updated', context.workingDirectory);
  }
}

export class EngineerTaskCancelTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_task_cancel',
    description: '取消 EngineerCat 工程任务以及底层 Codex job。',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'engineer_task_run 返回的 task_id。'
        }
      },
      required: ['task_id']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const taskId = readString(args.task_id);
    if (!taskId) {
      return '错误：task_id 不能为空';
    }
    return createRunner(context).cancel(taskId);
  }

  getArtifactManifest(args: any, _result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    const taskId = readString(args.task_id);
    return engineerTaskArtifacts(taskId, ['task.json'], 'updated', context.workingDirectory);
  }
}

export class EngineerCodexSupervisorStartTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_codex_supervisor_start',
    description: [
      '创建一个多 Codex worker 的 EngineerCat supervisor run。',
      '用于一个 agent 统一管理多个 engineer_task/Codex session：支持 max_parallel、depends_on、批量状态、聚合证据。'
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: '整个 supervisor run 的工程目标。'
        },
        supervisor_id: {
          type: 'string',
          description: '可选稳定 supervisor id；不填自动生成。'
        },
        cwd: {
          type: 'string',
          description: '默认项目工作目录。worker 未指定 cwd 时继承它。'
        },
        max_parallel: {
          type: 'number',
          description: '同一时间最多启动多少个 Codex worker，默认 2，最大 8。'
        },
        workers: {
          type: 'array',
          description: '要调度的 Codex workers。每个 worker 会成为一个 engineer_task。',
          items: {
            type: 'object',
            properties: {
              worker_id: { type: 'string', description: 'worker 稳定 id，用于依赖、resume 和 cancel。' },
              label: { type: 'string', description: '人类可读标签。' },
              request: { type: 'string', description: '该 worker 的完整工程任务。' },
              cwd: { type: 'string', description: '该 worker 的工作目录。默认继承 supervisor cwd。' },
              codex_session_id: { type: 'string', description: '可选；让该 worker resume 既有 Codex session。' },
              depends_on: { type: 'array', items: { type: 'string' }, description: '依赖的 worker_id 列表。全部 completed 后才启动。' },
              priority: { type: 'number', description: '同批 ready worker 的优先级，越大越先启动。' },
              allow_edits: { type: 'boolean', description: '是否允许该 worker 修改工作区。默认 true。' },
              sandbox: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'], description: 'Codex sandbox。' },
              model: { type: 'string', description: '可选 Codex model。' },
              timeout_ms: { type: 'number', description: 'Codex job 超时时间。' },
              validation_commands: { type: 'array', items: { type: 'string' }, description: '该 worker 完成后的验证命令。' },
              validation_timeout_ms: { type: 'number', description: '单条验证命令超时时间。' },
              skip_git_repo_check: { type: 'boolean', description: '是否允许非 git 仓库。默认 false。' }
            },
            required: ['request']
          }
        }
      },
      required: ['goal', 'workers']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const goal = readString(args.goal);
    if (!goal) {
      return '错误：goal 不能为空';
    }
    const workers = readSupervisorWorkers(args.workers, context);
    if (workers.length === 0) {
      return '错误：workers 不能为空';
    }
    try {
      const supervisor = await createSupervisor(context).create({
        supervisorId: readOptionalString(args.supervisor_id),
        goal,
        cwd: resolveCwd(context.workingDirectory, args.cwd),
        maxParallel: readOptionalPositiveNumber(args.max_parallel),
        workers,
      });
      return formatSupervisor(supervisor);
    } catch (error: any) {
      return `engineer_codex_supervisor_start 启动失败: ${String(error?.message || error)}`;
    }
  }

  getArtifactManifest(_args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    return artifactsFromKeys(result, ['supervisor_file', 'plan', 'aggregate'], 'created', context.workingDirectory);
  }
}

export class EngineerCodexSupervisorStatusTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_codex_supervisor_status',
    description: '批量同步 EngineerCat Codex supervisor 下所有 worker 状态，按依赖启动 queued worker，并刷新 aggregate.md。',
    parameters: {
      type: 'object',
      properties: {
        supervisor_id: { type: 'string', description: 'engineer_codex_supervisor_start 返回的 supervisor_id。' },
        wait_ms: { type: 'number', description: '总等待时间，会在 running workers 之间分摊。默认 0。' },
        poll_interval_ms: { type: 'number', description: '轮询间隔，默认 5000ms。' },
        verbose: { type: 'boolean', description: '是否透出底层 Codex verbose 状态。默认 false。' }
      },
      required: ['supervisor_id']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const supervisorId = readString(args.supervisor_id);
    if (!supervisorId) {
      return '错误：supervisor_id 不能为空';
    }
    const supervisor = await createSupervisor(context).status({
      supervisorId,
      waitMs: readNonNegativeNumber(args.wait_ms, 0),
      pollIntervalMs: readPositiveNumber(args.poll_interval_ms, DEFAULT_POLL_INTERVAL_MS),
      verbose: args.verbose === true,
    });
    return supervisor ? formatSupervisor(supervisor) : `错误：找不到 engineer_codex_supervisor: ${supervisorId}`;
  }

  getArtifactManifest(_args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    return [
      ...artifactsFromKeys(result, ['supervisor_file', 'aggregate'], 'updated', context.workingDirectory),
      ...artifactsFromKeys(result, ['plan'], 'captured', context.workingDirectory),
    ];
  }
}

export class EngineerCodexSupervisorResumeTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_codex_supervisor_resume',
    description: '对 supervisor 中的指定 worker 追加反馈，继续 resume 同一个 Codex session 返工。',
    parameters: {
      type: 'object',
      properties: {
        supervisor_id: { type: 'string', description: 'supervisor id。' },
        worker_id: { type: 'string', description: '要 resume 的 worker_id。' },
        task_id: { type: 'string', description: '可选；也可用 task_id 定位 worker。' },
        feedback: { type: 'string', description: '给该 worker/Codex session 的新增反馈。' },
        cwd: { type: 'string', description: '可选工作目录；默认继承 worker cwd。' },
        timeout_ms: { type: 'number', description: 'Codex job 超时时间。' },
        allow_edits: { type: 'boolean', description: '是否允许修改。默认继承 worker。' },
        sandbox: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'], description: 'Codex sandbox。' },
        model: { type: 'string', description: '可选 Codex model。' },
        validation_commands: { type: 'array', items: { type: 'string' }, description: '本轮 resume 后要执行的验证命令。' },
        validation_timeout_ms: { type: 'number', description: '单条验证命令超时时间。' },
        skip_git_repo_check: { type: 'boolean', description: '是否允许非 git 仓库。' }
      },
      required: ['supervisor_id', 'feedback']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const supervisorId = readString(args.supervisor_id);
    const feedback = readString(args.feedback);
    if (!supervisorId || !feedback) {
      return '错误：supervisor_id 和 feedback 不能为空';
    }
    try {
      const supervisor = await createSupervisor(context).resume({
        supervisorId,
        workerId: readOptionalString(args.worker_id),
        taskId: readOptionalString(args.task_id),
        feedback,
        cwd: args.cwd ? resolveCwd(context.workingDirectory, args.cwd) : undefined,
        timeoutMs: readOptionalPositiveNumber(args.timeout_ms),
        allowEdits: typeof args.allow_edits === 'boolean' ? args.allow_edits : undefined,
        sandbox: readOptionalString(args.sandbox),
        model: readOptionalString(args.model),
        validationCommands: readStringArray(args.validation_commands),
        validationTimeoutMs: readOptionalPositiveNumber(args.validation_timeout_ms),
        skipGitRepoCheck: typeof args.skip_git_repo_check === 'boolean' ? args.skip_git_repo_check : undefined,
      });
      return supervisor ? formatSupervisor(supervisor) : `错误：找不到 engineer_codex_supervisor: ${supervisorId}`;
    } catch (error: any) {
      return `engineer_codex_supervisor_resume 失败: ${String(error?.message || error)}`;
    }
  }

  getArtifactManifest(_args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    return [
      ...artifactsFromKeys(result, ['supervisor_file', 'aggregate'], 'updated', context.workingDirectory),
      ...artifactsFromKeys(result, ['plan'], 'captured', context.workingDirectory),
    ];
  }
}

export class EngineerCodexSupervisorCancelTool implements Tool {
  definition: ToolDefinition = {
    name: 'engineer_codex_supervisor_cancel',
    description: '取消整个 Codex supervisor 或指定 worker，避免多 session 工程任务失控。',
    parameters: {
      type: 'object',
      properties: {
        supervisor_id: { type: 'string', description: 'supervisor id。' },
        worker_id: { type: 'string', description: '可选；只取消指定 worker。不填则取消所有未完成 workers。' }
      },
      required: ['supervisor_id']
    }
  };

  async execute(args: any, context: ToolExecutionContext): Promise<string> {
    const supervisorId = readString(args.supervisor_id);
    if (!supervisorId) {
      return '错误：supervisor_id 不能为空';
    }
    try {
      const supervisor = await createSupervisor(context).cancel({
        supervisorId,
        workerId: readOptionalString(args.worker_id),
      });
      return supervisor ? formatSupervisor(supervisor) : `错误：找不到 engineer_codex_supervisor: ${supervisorId}`;
    } catch (error: any) {
      return `engineer_codex_supervisor_cancel 失败: ${String(error?.message || error)}`;
    }
  }

  getArtifactManifest(_args: any, result: string, context: ToolExecutionContext): ArtifactManifestItem[] {
    return [
      ...artifactsFromKeys(result, ['supervisor_file', 'aggregate'], 'updated', context.workingDirectory),
      ...artifactsFromKeys(result, ['plan'], 'captured', context.workingDirectory),
    ];
  }
}

function createRunner(context: ToolExecutionContext): EngineerTaskRunner {
  return new EngineerTaskRunner(new ToolCodexTaskAdapter(context));
}

function createSupervisor(context: ToolExecutionContext): EngineerCodexSupervisor {
  return new EngineerCodexSupervisor(createRunner(context));
}

function resolveCwd(base: string, value: unknown): string {
  const text = String(value || '.').trim();
  return path.resolve(base, text || '.');
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value);
  return text || undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value.map(item => readString(item)).filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function readSupervisorWorkers(value: unknown, context: ToolExecutionContext): EngineerSupervisorWorkerInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(item => {
    const worker = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      workerId: readOptionalString(worker.worker_id),
      label: readOptionalString(worker.label),
      request: readString(worker.request),
      cwd: worker.cwd ? resolveCwd(context.workingDirectory, worker.cwd) : undefined,
      codexSessionId: readOptionalString(worker.codex_session_id),
      dependsOn: readStringArray(worker.depends_on),
      priority: readOptionalPositiveNumber(worker.priority),
      allowEdits: typeof worker.allow_edits === 'boolean' ? worker.allow_edits : undefined,
      sandbox: readOptionalString(worker.sandbox),
      model: readOptionalString(worker.model),
      timeoutMs: readOptionalPositiveNumber(worker.timeout_ms),
      validationCommands: readStringArray(worker.validation_commands),
      validationTimeoutMs: readOptionalPositiveNumber(worker.validation_timeout_ms),
      skipGitRepoCheck: typeof worker.skip_git_repo_check === 'boolean' ? worker.skip_git_repo_check : undefined,
    };
  }).filter(worker => worker.request);
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function artifactsFromKeys(
  result: string,
  keys: string[],
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
): ArtifactManifestItem[] {
  return keys
    .map(key => artifactFromPath(keyValue(result, key), action, workingDirectory))
    .filter((item): item is ArtifactManifestItem => Boolean(item));
}

function engineerTaskArtifacts(
  taskId: string,
  fileNames: string[],
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
): ArtifactManifestItem[] {
  const segment = safePathSegment(taskId);
  if (!segment) return [];
  return fileNames
    .map(fileName => artifactFromPath(
      path.join('data', 'engineer-tasks', segment, fileName),
      action,
      workingDirectory,
    ))
    .filter((item): item is ArtifactManifestItem => Boolean(item));
}

function artifactFromPath(
  value: unknown,
  action: ArtifactManifestItem['action'],
  workingDirectory: string,
): ArtifactManifestItem | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = workspaceRelativeArtifactPath(value, workingDirectory);
  return {
    path: normalized,
    type: artifactType(normalized),
    action,
  };
}

function keyValue(text: string, key: string): string {
  const pattern = new RegExp(`^${key}=([^\\r\\n]+)$`, 'm');
  return pattern.exec(String(text || ''))?.[1]?.trim() || '';
}

function workspaceRelativeArtifactPath(value: string, workingDirectory: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  const cwd = workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.startsWith(`${cwd}/`)) {
    return normalized.slice(cwd.length + 1);
  }
  return normalized.replace(/^\/+/, '');
}

function artifactType(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return ext || 'file';
}

function safePathSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
