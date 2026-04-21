import * as fs from 'fs';
import * as path from 'path';
import { AgentSession, AgentServices } from '../../../core/agent-session';
import { SkillManager } from '../../../skills/skill-manager';
import { ToolManager } from '../../../tools/tool-manager';
import { AutoDevCaseDetail } from '../../../utils/autodev-client';
import { AutoDevReviewerOutput, readJsonFile } from '../../../utils/autodev-loop-contract';
import { AIService } from '../../../utils/ai-service';

export interface ReviewerExecutionSummary {
  overview: string;
  artifactCount: number;
  decision: 'closed' | 'reopened';
  nextState: 'closed' | 'reopened';
}

export interface ReviewerAgentExecutionResult {
  generatedAt: string;
  caseId: string;
  mode: 'agent_review';
  summary: ReviewerExecutionSummary;
  reviewFilePath?: string;
  outputFilePath?: string;
  closureFilePath?: string;
  finalText?: string;
}

export interface ReviewerWorkspaceStore {
  getCaseDir(caseId: string): string;
}

export interface ReviewerExecutionExecutor {
  executeCase(detail: AutoDevCaseDetail, store: ReviewerWorkspaceStore): Promise<ReviewerAgentExecutionResult>;
}

interface ReviewerAgentExecutionExecutorOptions {
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

export class ReviewerAgentExecutionExecutor implements ReviewerExecutionExecutor {
  private readonly repoRoot: string;

  constructor(options: ReviewerAgentExecutionExecutorOptions = {}) {
    this.repoRoot = path.resolve(options.repoRoot || process.cwd());
  }

  async executeCase(detail: AutoDevCaseDetail, store: ReviewerWorkspaceStore): Promise<ReviewerAgentExecutionResult> {
    const caseId = detail.case.case_id;
    const caseDir = store.getCaseDir(caseId);
    const reviewPath = path.join(caseDir, 'review.md');
    const outputPath = path.join(caseDir, 'reviewer-output.json');
    const closurePath = path.join(caseDir, 'closure.md');
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

    const session = new AgentSession(`autodev-reviewer:${caseId}`, services, 'chat');
    const artifactLines = manifest.length > 0
      ? manifest
        .map(item => `- [${item.stage}] ${item.type}: ${item.localPath}${item.originalFilename ? ` (source=${item.originalFilename})` : ''}`)
        .join('\n')
      : '- 无已下载 artifacts';

    const taskMessage = [
      '现在有一个 AutoDev case 转交给你，请你以 ReviewerCat 身份做验收。',
      '',
      '你的任务：',
      '1. 先读取 case-detail.json、artifacts-manifest.json、Inspector assessment、Engineer implementation 和 patch。',
      '2. 判断 EngineerCat 的结果是否真的解决了这个 case，或者应该重开。',
      '3. 必须把验证结果落盘，不能只给一句结论。',
      '4. 验证报告必须写到：',
      reviewPath,
      '5. 结构化决策必须写到：',
      outputPath,
      '6. closure note 建议写到：',
      closurePath,
      '7. reviewer-output.json 必须至少包含这些字段：',
      '{',
      '  "version": 1,',
      '  "summary": "一句话总结验证结论",',
      '  "overview": "给平台和人看的 2-4 句结论",',
      '  "decision": "closed | reopened",',
      '  "decisionReason": "为什么这样判定",',
      '  "nextState": "closed | reopened",',
      '  "regressionStatus": "passed | failed | partial",',
      '  "riskLevel": "low | medium | high",',
      '  "artifacts": [{"path":"相对 case 目录的附加交付文件","type":"review","stage":"verification","title":"可读标题"}],',
      '  "writebackPlan": {',
      '    "enabled": true 或 false,',
      '    "reason": "是否应该回写到主系统",',
      '    "actions": []',
      '  }',
      '}',
      '8. 只有确认结果被验证通过时，才能 decision=closed；否则必须 reopened。',
      '9. 你不能修改 case 状态，只负责写出验证结论文件。',
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

      const output = readJsonFile<AutoDevReviewerOutput>(outputPath);
      const artifactCount = [reviewPath, outputPath, closurePath]
        .filter(filePath => fs.existsSync(filePath))
        .length
        + (Array.isArray(output?.artifacts) ? output!.artifacts.length : 0);
      const decision = output?.decision === 'reopened' ? 'reopened' : 'closed';
      const nextState = output?.nextState === 'reopened' ? 'reopened' : decision;
      const overview = String(
        output?.overview
        || output?.summary
        || result.text
        || 'ReviewerCat completed the validation step.',
      ).trim();

      return {
        generatedAt: new Date().toISOString(),
        caseId,
        mode: 'agent_review',
        summary: {
          overview,
          artifactCount,
          decision,
          nextState,
        },
        reviewFilePath: fs.existsSync(reviewPath) ? path.relative(caseDir, reviewPath).replace(/\\/g, '/') : undefined,
        outputFilePath: fs.existsSync(outputPath) ? path.relative(caseDir, outputPath).replace(/\\/g, '/') : undefined,
        closureFilePath: fs.existsSync(closurePath) ? path.relative(caseDir, closurePath).replace(/\\/g, '/') : undefined,
        finalText: result.text,
      };
    } catch (error) {
      await session.cleanup().catch(() => undefined);
      throw error;
    }
  }
}

export function createReviewerExecutionExecutorFromEnv(): ReviewerExecutionExecutor {
  return new ReviewerAgentExecutionExecutor();
}
