import * as path from 'path';
import { Tool, ToolDefinition, ToolExecutionContext } from '../../../types/tool';
import {
  EngineerTaskRunner,
  ToolCodexTaskAdapter,
} from '../utils/engineer-task-runner';

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
}

function createRunner(context: ToolExecutionContext): EngineerTaskRunner {
  return new EngineerTaskRunner(new ToolCodexTaskAdapter(context));
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
