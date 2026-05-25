import * as fs from 'fs';
import * as path from 'path';
import { createRoleAwareToolManager } from '../../../bootstrap/tool-manager';
import { AgentSession, AgentServices } from '../../../core/agent-session';
import { SkillManager } from '../../../skills/skill-manager';
import { AutoDevCaseDetail } from '../../../utils/autodev-client';
import { AutoDevEngineerOutput, readJsonFile } from '../../../utils/autodev-loop-contract';
import { AIService } from '../../../utils/ai-service';
import {
  CodexTaskAdapter,
  EngineerTaskRunner,
  ToolCodexTaskAdapter,
  readTask,
} from './engineer-task-runner';

export interface EngineerExecutionSummary {
  overview: string;
  artifactCount: number;
  nextState: 'reviewing' | 'blocked';
  implementationGenerated: boolean;
}

export interface EngineerAgentExecutionResult {
  generatedAt: string;
  caseId: string;
  mode: 'agent_execute';
  summary: EngineerExecutionSummary;
  implementationNotePath?: string;
  outputFilePath?: string;
  patchFilePath?: string;
  finalText?: string;
}

export interface EngineerWorkspaceStore {
  getCaseDir(caseId: string): string;
}

export interface EngineerExecutionExecutor {
  executeCase(detail: AutoDevCaseDetail, store: EngineerWorkspaceStore): Promise<EngineerAgentExecutionResult>;
}

interface EngineerAgentExecutionExecutorOptions {
  repoRoot?: string;
}

interface EngineerTaskExecutionExecutorOptions {
  repoRoot?: string;
  codexAdapter?: CodexTaskAdapter;
  statusWaitMs?: number;
  statusPollIntervalMs?: number;
  validationCommands?: string[];
  validationTimeoutMs?: number;
}

interface DownloadedArtifactManifestItem {
  artifactId: string;
  type: string;
  stage: string;
  title: string;
  localPath: string;
  originalFilename?: string | null;
}

export class EngineerAgentExecutionExecutor implements EngineerExecutionExecutor {
  private readonly repoRoot: string;

  constructor(options: EngineerAgentExecutionExecutorOptions = {}) {
    this.repoRoot = path.resolve(options.repoRoot || process.cwd());
  }

  async executeCase(detail: AutoDevCaseDetail, store: EngineerWorkspaceStore): Promise<EngineerAgentExecutionResult> {
    const caseId = detail.case.case_id;
    const caseDir = store.getCaseDir(caseId);
    const implementationNotePath = path.join(caseDir, 'implementation.md');
    const outputPath = path.join(caseDir, 'engineer-output.json');
    const patchPath = path.join(caseDir, 'implementation.patch');
    const manifestPath = path.join(caseDir, 'artifacts-manifest.json');
    const caseDetailPath = path.join(caseDir, 'case-detail.json');
    const manifest = readJsonFile<DownloadedArtifactManifestItem[]>(manifestPath) || [];

    const skillManager = new SkillManager();
    await skillManager.loadSkills();

    const services: AgentServices = {
      aiService: new AIService(),
      toolManager: createRoleAwareToolManager(this.repoRoot),
      skillManager,
    };

    const session = new AgentSession(`autodev-engineer:${caseId}`, services, 'chat');
    const artifactLines = manifest.length > 0
      ? manifest
        .map(item => `- [${item.stage}] ${item.type}: ${item.localPath}${item.originalFilename ? ` (source=${item.originalFilename})` : ''}`)
        .join('\n')
      : '- 无已下载 artifacts';

    const taskMessage = [
      '现在有一个 AutoDev case 转交给你，请你以 EngineerCat 身份直接处理。',
      '',
      '你的任务：',
      '1. 先读取 case-detail.json、artifacts-manifest.json 和 assessment / log 等输入材料。',
      '2. 根据 case.category 决定是修 runtime、修已有 skill，还是调用 self-evolution 生成新 skill。',
      '3. 不能只给文字结论，必须把实现结果落盘。',
      '4. 实现说明必须写到：',
      implementationNotePath,
      '5. 结构化结果必须写到：',
      outputPath,
      '6. 如果你修改了代码、skill、prompt 或配置，尽量把 diff 或补丁写到：',
      patchPath,
      '7. engineer-output.json 必须至少包含这些字段：',
      '{',
      '  "version": 1,',
      '  "summary": "一句话总结你做了什么",',
      '  "overview": "给 Reviewer 的 2-4 句交接说明",',
      '  "resultType": "runtime_fix | skill_fix | skill_bundle | blocked | no_op",',
      '  "riskLevel": "low | medium | high",',
      '  "nextState": "reviewing | blocked",',
      '  "recommendedNextAction": "review_engineer_output 或更具体动作",',
      '  "changedFiles": ["相对仓库根目录的文件路径"],',
      '  "artifacts": [{"path":"相对 case 目录的附加交付文件","type":"implementation","stage":"execution","title":"可读标题"}]',
      '}',
      '8. 不要调用 send_file 或 send_text；只需要把文件写到指定位置。',
      '9. 你不能 self-close，只能把 case 交给 reviewing 或 blocked。',
      '',
      `仓库根目录：${this.repoRoot}`,
      `Case 工作目录：${caseDir}`,
      `Case 详情文件：${caseDetailPath}`,
      '已下载输入材料：',
      artifactLines,
      '',
      `案件信息：caseId=${caseId}，status=${detail.case.status}，category=${detail.case.category || 'unknown'}，recommendedNextAction=${detail.case.recommended_next_action || 'n/a'}`,
      `案件摘要：${detail.case.summary || 'n/a'}`,
    ].join('\n');

    try {
      const result = await session.handleMessage(taskMessage);
      await session.cleanup();

      const output = readJsonFile<AutoDevEngineerOutput>(outputPath);
      const implementationGenerated = fs.existsSync(implementationNotePath);
      const artifactCount = [implementationNotePath, outputPath, patchPath]
        .filter(filePath => fs.existsSync(filePath))
        .length
        + (Array.isArray(output?.artifacts) ? output!.artifacts.length : 0);
      const nextState = output?.nextState === 'reviewing' && implementationGenerated ? 'reviewing' : 'blocked';
      const overview = String(
        output?.overview
        || output?.summary
        || result.text
        || 'EngineerCat did not produce complete structured execution evidence for the AutoDev case.',
      ).trim();

      return {
        generatedAt: new Date().toISOString(),
        caseId,
        mode: 'agent_execute',
        summary: {
          overview,
          artifactCount,
          nextState,
          implementationGenerated,
        },
        implementationNotePath: implementationGenerated ? path.relative(caseDir, implementationNotePath).replace(/\\/g, '/') : undefined,
        outputFilePath: fs.existsSync(outputPath) ? path.relative(caseDir, outputPath).replace(/\\/g, '/') : undefined,
        patchFilePath: fs.existsSync(patchPath) ? path.relative(caseDir, patchPath).replace(/\\/g, '/') : undefined,
        finalText: result.text,
      };
    } catch (error) {
      await session.cleanup().catch(() => undefined);
      throw error;
    }
  }
}

export function createEngineerExecutionExecutorFromEnv(): EngineerExecutionExecutor {
  if (process.env.AUTODEV_ENGINEER_EXECUTOR === 'agent_session') {
    return new EngineerAgentExecutionExecutor();
  }
  return new EngineerTaskExecutionExecutor({
    validationCommands: readValidationCommandsEnv(),
  });
}

export class EngineerTaskExecutionExecutor implements EngineerExecutionExecutor {
  private readonly repoRoot: string;
  private readonly codexAdapter?: CodexTaskAdapter;
  private readonly statusWaitMs: number;
  private readonly statusPollIntervalMs: number;
  private readonly validationCommands: string[];
  private readonly validationTimeoutMs: number;

  constructor(options: EngineerTaskExecutionExecutorOptions = {}) {
    this.repoRoot = path.resolve(options.repoRoot || process.cwd());
    this.codexAdapter = options.codexAdapter;
    this.statusWaitMs = options.statusWaitMs || readPositiveEnv('AUTODEV_ENGINEER_TASK_WAIT_MS', 30 * 60 * 1000);
    this.statusPollIntervalMs = options.statusPollIntervalMs || readPositiveEnv('AUTODEV_ENGINEER_TASK_POLL_MS', 5000);
    this.validationCommands = options.validationCommands || [];
    this.validationTimeoutMs = options.validationTimeoutMs || readPositiveEnv('AUTODEV_ENGINEER_VALIDATION_TIMEOUT_MS', 5 * 60 * 1000);
  }

  async executeCase(detail: AutoDevCaseDetail, store: EngineerWorkspaceStore): Promise<EngineerAgentExecutionResult> {
    const caseId = detail.case.case_id;
    const caseDir = store.getCaseDir(caseId);
    const implementationNotePath = path.join(caseDir, 'implementation.md');
    const outputPath = path.join(caseDir, 'engineer-output.json');
    const patchPath = path.join(caseDir, 'implementation.patch');
    const manifestPath = path.join(caseDir, 'artifacts-manifest.json');
    const caseDetailPath = path.join(caseDir, 'case-detail.json');
    const manifest = readJsonFile<DownloadedArtifactManifestItem[]>(manifestPath) || [];
    const taskReportPath = path.join(caseDir, 'engineer-task.md');

    const runner = new EngineerTaskRunner(
      this.codexAdapter || new ToolCodexTaskAdapter({
        workingDirectory: this.repoRoot,
        conversationHistory: [],
      }),
    );
    const task = await runner.run({
      request: this.buildTaskRequest({
        detail,
        caseDir,
        caseDetailPath,
        manifest,
        implementationNotePath,
        outputPath,
        patchPath,
      }),
      taskId: `autodev-${safeSegment(caseId)}-${Date.now()}`,
      cwd: this.repoRoot,
      allowEdits: true,
      sandbox: 'workspace-write',
      timeoutMs: readPositiveEnv('AUTODEV_ENGINEER_CODEX_TIMEOUT_MS', 30 * 60 * 1000),
      validationCommands: this.validationCommands,
      validationTimeoutMs: this.validationTimeoutMs,
      skipGitRepoCheck: false,
    });

    const statusOutput = await runner.status({
      taskId: task.taskId,
      waitMs: this.statusWaitMs,
      pollIntervalMs: this.statusPollIntervalMs,
      verbose: true,
    });
    const completedTask = readTask(task.taskId) || task;
    this.writeTaskReport(taskReportPath, completedTask.taskId, statusOutput);
    this.copyTaskValidation(completedTask.artifacts.validation, path.join(caseDir, 'validation.md'));

    const output = readJsonFile<AutoDevEngineerOutput>(outputPath);
    const implementationGenerated = fs.existsSync(implementationNotePath);
    const artifactCount = [implementationNotePath, outputPath, patchPath, taskReportPath, path.join(caseDir, 'validation.md')]
      .filter(filePath => fs.existsSync(filePath))
      .length
      + (Array.isArray(output?.artifacts) ? output!.artifacts.length : 0);
    const nextState = completedTask.status === 'completed'
      && output?.nextState === 'reviewing'
      && implementationGenerated
      ? 'reviewing'
      : 'blocked';
    const overview = String(
      output?.overview
      || output?.summary
      || completedTask.lastMessage
      || 'EngineerTaskRunner did not produce complete structured execution evidence for the AutoDev case.',
    ).trim();

    return {
      generatedAt: new Date().toISOString(),
      caseId,
      mode: 'agent_execute',
      summary: {
        overview,
        artifactCount,
        nextState,
        implementationGenerated,
      },
      implementationNotePath: implementationGenerated ? path.relative(caseDir, implementationNotePath).replace(/\\/g, '/') : undefined,
      outputFilePath: fs.existsSync(outputPath) ? path.relative(caseDir, outputPath).replace(/\\/g, '/') : undefined,
      patchFilePath: fs.existsSync(patchPath) ? path.relative(caseDir, patchPath).replace(/\\/g, '/') : undefined,
      finalText: statusOutput,
    };
  }

  private buildTaskRequest(input: {
    detail: AutoDevCaseDetail;
    caseDir: string;
    caseDetailPath: string;
    manifest: DownloadedArtifactManifestItem[];
    implementationNotePath: string;
    outputPath: string;
    patchPath: string;
  }): string {
    const { detail, caseDir, caseDetailPath, manifest, implementationNotePath, outputPath, patchPath } = input;
    const artifactLines = manifest.length > 0
      ? manifest
        .map(item => `- [${item.stage}] ${item.type}: ${item.localPath}${item.originalFilename ? ` (source=${item.originalFilename})` : ''}`)
        .join('\n')
      : '- 无已下载 artifacts';

    return [
      '现在有一个 AutoDev case 转交给 EngineerCat，请你直接处理并把结果落盘。',
      '',
      '硬性产物：',
      `1. 实现说明必须写到：${implementationNotePath}`,
      `2. 结构化结果必须写到：${outputPath}`,
      `3. 如果修改了代码、skill、prompt 或配置，尽量把 diff 或补丁写到：${patchPath}`,
      '4. engineer-output.json 的 nextState 只能是 reviewing 或 blocked，不能 self-close。',
      '5. 如果无法完成，仍要写 implementation.md 和 blocked 的 engineer-output.json，说明缺什么。',
      '',
      'engineer-output.json 至少包含：',
      '{',
      '  "version": 1,',
      '  "summary": "一句话总结你做了什么",',
      '  "overview": "给 Reviewer 的 2-4 句交接说明",',
      '  "resultType": "runtime_fix | skill_fix | skill_bundle | blocked | no_op",',
      '  "riskLevel": "low | medium | high",',
      '  "nextState": "reviewing | blocked",',
      '  "recommendedNextAction": "review_engineer_output 或更具体动作",',
      '  "changedFiles": ["相对仓库根目录的文件路径"],',
      '  "artifacts": [{"path":"相对 case 目录的附加交付文件","type":"implementation","stage":"execution","title":"可读标题"}]',
      '}',
      '',
      `仓库根目录：${this.repoRoot}`,
      `Case 工作目录：${caseDir}`,
      `Case 详情文件：${caseDetailPath}`,
      '已下载输入材料：',
      artifactLines,
      '',
      `案件信息：caseId=${detail.case.case_id}，status=${detail.case.status}，category=${detail.case.category || 'unknown'}，recommendedNextAction=${detail.case.recommended_next_action || 'n/a'}`,
      `案件摘要：${detail.case.summary || 'n/a'}`,
      '',
      '请先读 case-detail.json、artifacts-manifest.json 和输入材料，再做最小实现和验证。',
    ].join('\n');
  }

  private writeTaskReport(reportPath: string, taskId: string, statusOutput: string): void {
    fs.writeFileSync(
      reportPath,
      [
        `# Engineer Task ${taskId}`,
        '',
        '## Status Output',
        '',
        '```text',
        statusOutput,
        '```',
      ].join('\n'),
      'utf-8',
    );
  }

  private copyTaskValidation(sourcePath: string | undefined, targetPath: string): void {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function readValidationCommandsEnv(): string[] {
  const raw = String(process.env.AUTODEV_ENGINEER_VALIDATION_COMMANDS || '').trim();
  if (!raw) {
    return [];
  }
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return raw.split('\n').map(item => item.trim()).filter(Boolean);
}

function readPositiveEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'case';
}
