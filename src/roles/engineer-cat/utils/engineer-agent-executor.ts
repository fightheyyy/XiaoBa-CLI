import * as fs from 'fs';
import * as path from 'path';
import { AgentSession, AgentServices } from '../../../core/agent-session';
import { SkillManager } from '../../../skills/skill-manager';
import { ToolManager } from '../../../tools/tool-manager';
import { AutoDevCaseDetail } from '../../../utils/autodev-client';
import { AutoDevEngineerOutput, readJsonFile } from '../../../utils/autodev-loop-contract';
import { AIService } from '../../../utils/ai-service';

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
      toolManager: new ToolManager(this.repoRoot),
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
      const nextState = output?.nextState === 'blocked' ? 'blocked' : 'reviewing';
      const overview = String(
        output?.overview
        || output?.summary
        || result.text
        || 'EngineerCat completed execution for the AutoDev case.',
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
  return new EngineerAgentExecutionExecutor();
}
