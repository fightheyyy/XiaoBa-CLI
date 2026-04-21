import * as fs from 'fs';
import * as path from 'path';
import { AutoDevArtifactRecord, AutoDevCaseDetail, AutoDevCaseSummary, AutoDevClient } from '../../../utils/autodev-client';
import {
  AutoDevEngineerOutput,
  AutoDevLoopMetrics,
  AutoDevReviewerArtifactDescriptor,
  AutoDevReviewerOutput,
  AutoDevWritebackPlan,
  AutoDevWritebackResult,
  createDefaultWritebackPlan,
  createLoopMetrics,
  readJsonFile,
} from '../../../utils/autodev-loop-contract';
import { Logger } from '../../../utils/logger';
import {
  createReviewerExecutionExecutorFromEnv,
  ReviewerAgentExecutionResult,
  ReviewerExecutionExecutor,
  ReviewerWorkspaceStore,
} from './reviewer-agent-executor';
import {
  createReviewerWritebackExecutorFromEnv,
  ReviewerWritebackExecutor,
} from './reviewer-writeback-executor';

interface AutoDevReviewerWorkerOptions {
  workingDirectory?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  executionExecutor?: ReviewerExecutionExecutor;
  writebackExecutor?: ReviewerWritebackExecutor;
  client?: AutoDevClient;
  keepSuccessfulWorkdir?: boolean;
}

interface DownloadedArtifactManifestItem {
  artifactId: string;
  type: string;
  stage: string;
  title: string;
  localPath: string;
  originalFilename?: string | null;
}

interface PreparedReviewerCase {
  detail: AutoDevCaseDetail;
  downloadedArtifacts: DownloadedArtifactManifestItem[];
}

export interface AutoDevReviewerRunResult {
  processed: number;
  skipped: boolean;
}

const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

class LocalReviewerWorkspaceStore implements ReviewerWorkspaceStore {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  getCaseDir(caseId: string): string {
    return path.join(this.baseDir, caseId);
  }
}

export class AutoDevReviewerWorker {
  private readonly client: AutoDevClient;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly executionExecutor: ReviewerExecutionExecutor;
  private readonly writebackExecutor: ReviewerWritebackExecutor;
  private readonly workspaceStore: ReviewerWorkspaceStore;
  private readonly keepSuccessfulWorkdir: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: AutoDevReviewerWorkerOptions = {}) {
    this.client = options.client || new AutoDevClient();
    this.batchSize = options.batchSize || readNumberEnv('AUTODEV_REVIEWER_BATCH_SIZE', DEFAULT_BATCH_SIZE);
    this.pollIntervalMs = options.pollIntervalMs || readNumberEnv('AUTODEV_REVIEWER_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);
    this.executionExecutor = options.executionExecutor || createReviewerExecutionExecutorFromEnv();
    this.writebackExecutor = options.writebackExecutor || createReviewerWritebackExecutorFromEnv();
    const workingDirectory = options.workingDirectory || process.cwd();
    this.workspaceStore = new LocalReviewerWorkspaceStore(
      path.resolve(workingDirectory, 'data', 'autodev-reviewer-cases'),
    );
    this.keepSuccessfulWorkdir = options.keepSuccessfulWorkdir === true;
  }

  static isEnabled(): boolean {
    return new AutoDevClient().isConfigured();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    Logger.info(
      `[AutoDevReviewerWorker] scheduler started (poll=${this.pollIntervalMs}ms, base=${this.client.getBaseUrl()})`,
    );
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.pollIntervalMs);
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    Logger.info('[AutoDevReviewerWorker] scheduler stopped');
  }

  async runOnce(): Promise<AutoDevReviewerRunResult> {
    if (this.running || !this.client.isConfigured()) {
      return { processed: 0, skipped: true };
    }

    this.running = true;
    let processed = 0;
    try {
      const queue = await this.listPendingCases();
      for (const item of queue) {
        await this.processCase(item);
        processed += 1;
      }
    } catch (error: any) {
      Logger.warning(`[AutoDevReviewerWorker] queue poll failed: ${String(error?.message || error)}`);
    } finally {
      this.running = false;
    }

    return { processed, skipped: false };
  }

  private async listPendingCases(): Promise<AutoDevCaseSummary[]> {
    const items = await this.client.listCases({
      owner: 'reviewer',
      limit: this.batchSize * 3,
    });

    return items
      .filter(item => item.status === 'reviewing')
      .slice(0, this.batchSize);
  }

  private async processCase(summary: AutoDevCaseSummary): Promise<void> {
    const caseId = summary.case_id;
    let prepared: PreparedReviewerCase | null = null;

    try {
      await this.client.appendEvent(caseId, {
        kind: 'reviewer_validation_started',
        actor_id: 'reviewer',
        payload: {
          active_status: summary.status,
          category: summary.category || null,
        },
      });

      const detail = await this.client.getCaseDetail(caseId);
      prepared = await this.prepareCase(detail);
      const result = await this.executionExecutor.executeCase(prepared.detail, this.workspaceStore);
      const shouldCleanup = await this.persistReview(prepared, result);
      if (shouldCleanup) {
        this.cleanupWorkspace(caseId);
      }
      Logger.info(`[AutoDevReviewerWorker] completed ${caseId}`);
    } catch (error: any) {
      await this.persistFailure(summary, error);
      Logger.error(`[AutoDevReviewerWorker] failed ${caseId}: ${String(error?.message || error)}`);
      if (prepared) {
        Logger.info(`[AutoDevReviewerWorker] kept workspace for failed case ${caseId}: ${this.workspaceStore.getCaseDir(caseId)}`);
      }
    }
  }

  private async prepareCase(detail: AutoDevCaseDetail): Promise<PreparedReviewerCase> {
    const caseId = detail.case.case_id;
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    const artifactsDir = path.join(workspaceDir, 'artifacts');
    fs.mkdirSync(artifactsDir, { recursive: true });

    const downloadedArtifacts: DownloadedArtifactManifestItem[] = [];
    for (const artifact of detail.artifacts || []) {
      const localPath = await this.downloadArtifact(caseId, artifactsDir, artifact);
      downloadedArtifacts.push({
        artifactId: artifact.artifact_id,
        type: String(artifact.type || 'attachment'),
        stage: String(artifact.stage || 'input'),
        title: String(artifact.title || artifact.artifact_id),
        localPath: path.relative(workspaceDir, localPath).replace(/\\/g, '/'),
        originalFilename: artifact.original_filename || null,
      });
    }

    fs.writeFileSync(path.join(workspaceDir, 'case-detail.json'), JSON.stringify(detail, null, 2), 'utf-8');
    fs.writeFileSync(path.join(workspaceDir, 'artifacts-manifest.json'), JSON.stringify(downloadedArtifacts, null, 2), 'utf-8');

    return { detail, downloadedArtifacts };
  }

  private async persistReview(prepared: PreparedReviewerCase, result: ReviewerAgentExecutionResult): Promise<boolean> {
    const caseId = prepared.detail.case.case_id;
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    fs.writeFileSync(path.join(workspaceDir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8');

    const reviewerOutput = result.outputFilePath
      ? readJsonFile<AutoDevReviewerOutput>(path.resolve(workspaceDir, result.outputFilePath))
      : readJsonFile<AutoDevReviewerOutput>(path.join(workspaceDir, 'reviewer-output.json'));
    const engineerOutputPath = findDownloadedArtifactPath(workspaceDir, prepared.downloadedArtifacts, 'implementation_summary');
    const engineerOutput = readJsonFile<AutoDevEngineerOutput>(path.join(workspaceDir, 'artifacts', 'execution', 'art-implementation_output-engineer-output.json'))
      || (engineerOutputPath ? readJsonFile<AutoDevEngineerOutput>(engineerOutputPath) : undefined);

    const normalizedOutput = this.normalizeReviewerOutput(reviewerOutput, result);
    const writebackPlan = normalizedOutput.writebackPlan || createDefaultWritebackPlan({
      detail: prepared.detail,
      engineerOutput,
      reviewerOutput: normalizedOutput,
    });
    const writebackResult = await this.executeWriteback(workspaceDir, prepared, writebackPlan, normalizedOutput.decision);
    const metrics = {
      ...createLoopMetrics({
        detail: prepared.detail,
        engineerOutput,
        reviewerOutput: normalizedOutput,
      }),
      ...(normalizedOutput.metrics || {}),
      writebackStatus: writebackResult?.status,
      writebackActionCount: writebackResult?.actionResults.length || 0,
      writebackAppliedCount: (writebackResult?.actionResults || []).filter(item => item.status === 'completed').length,
      writebackFailedCount: (writebackResult?.actionResults || []).filter(item => item.status === 'failed').length,
    } as AutoDevLoopMetrics;

    const writebackPath = path.join(workspaceDir, 'writeback-plan.json');
    fs.writeFileSync(writebackPath, JSON.stringify(writebackPlan, null, 2), 'utf-8');
    const metricsPath = path.join(workspaceDir, 'case-metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf-8');
    const writebackResultPath = path.join(workspaceDir, 'writeback-result.json');
    if (writebackResult) {
      fs.writeFileSync(writebackResultPath, JSON.stringify(writebackResult, null, 2), 'utf-8');
    }

    const uploadCount = await this.uploadReviewArtifacts(
      prepared.detail,
      normalizedOutput,
      writebackPath,
      metricsPath,
      writebackResult ? writebackResultPath : undefined,
    );

    await this.client.appendEvent(caseId, {
      kind: 'reviewer_validation_completed',
      actor_id: 'reviewer',
      payload: {
        overview: result.summary.overview,
        artifact_count: uploadCount,
        decision: normalizedOutput.decision,
        next_state: normalizedOutput.nextState || normalizedOutput.decision,
        writeback_enabled: writebackPlan.enabled,
        writeback_status: writebackResult?.status || null,
      },
    });

    await this.client.updateState(caseId, {
      from: 'reviewing',
      to: normalizedOutput.nextState || normalizedOutput.decision,
      actor_id: 'reviewer',
      reason: normalizedOutput.decisionReason,
      category: prepared.detail.case.category || undefined,
      recommended_next_action: this.resolveRecommendedNextAction(normalizedOutput, writebackPlan, writebackResult),
    });

    return normalizedOutput.decision !== 'closed'
      ? !this.keepSuccessfulWorkdir
      : (writebackResult?.status !== 'failed' && !this.keepSuccessfulWorkdir);
  }

  private async uploadReviewArtifacts(
    detail: AutoDevCaseDetail,
    output: AutoDevReviewerOutput,
    writebackPath: string,
    metricsPath: string,
    writebackResultPath?: string,
  ): Promise<number> {
    const caseId = detail.case.case_id;
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    const uploads = new Map<string, AutoDevReviewerArtifactDescriptor>();

    const reviewPath = path.join(workspaceDir, 'review.md');
    if (fs.existsSync(reviewPath)) {
      uploads.set(reviewPath, {
        path: reviewPath,
        type: 'review',
        stage: 'verification',
        title: 'Reviewer validation report',
        format: 'markdown',
      });
    }

    const outputPath = path.join(workspaceDir, 'reviewer-output.json');
    if (fs.existsSync(outputPath)) {
      uploads.set(outputPath, {
        path: outputPath,
        type: 'review_summary',
        stage: 'verification',
        title: 'Reviewer structured decision',
        format: 'json',
        contentType: 'application/json',
      });
    }

    const closurePath = path.join(workspaceDir, 'closure.md');
    if (fs.existsSync(closurePath)) {
      uploads.set(closurePath, {
        path: closurePath,
        type: 'closure_note',
        stage: 'closure',
        title: 'Closure summary',
        format: 'markdown',
      });
    }

    if (fs.existsSync(writebackPath)) {
      uploads.set(writebackPath, {
        path: writebackPath,
        type: 'writeback_plan',
        stage: 'closure',
        title: 'Writeback strategy',
        format: 'json',
        contentType: 'application/json',
      });
    }

    if (fs.existsSync(metricsPath)) {
      uploads.set(metricsPath, {
        path: metricsPath,
        type: 'metrics',
        stage: 'closure',
        title: 'Case loop metrics',
        format: 'json',
        contentType: 'application/json',
      });
    }

    if (writebackResultPath && fs.existsSync(writebackResultPath)) {
      uploads.set(writebackResultPath, {
        path: writebackResultPath,
        type: 'writeback_result',
        stage: 'closure',
        title: 'Writeback execution result',
        format: 'json',
        contentType: 'application/json',
      });
    }

    for (const artifact of output.artifacts || []) {
      const resolvedPath = this.resolveWorkspacePath(workspaceDir, artifact.path);
      if (!fs.existsSync(resolvedPath)) {
        continue;
      }
      uploads.set(resolvedPath, {
        path: resolvedPath,
        type: artifact.type || 'review',
        stage: artifact.stage || 'verification',
        title: artifact.title || path.basename(resolvedPath),
        format: artifact.format,
        contentType: artifact.contentType,
      });
    }

    for (const artifact of uploads.values()) {
      await this.client.uploadArtifact({
        caseId,
        filePath: artifact.path,
        type: artifact.type || 'review',
        stage: artifact.stage || 'verification',
        title: artifact.title || path.basename(artifact.path),
        producedByAgent: 'reviewer',
        format: artifact.format,
        contentType: artifact.contentType,
        metadata: {
          source_role: 'reviewer-cat',
          category: detail.case.category || null,
        },
      });
    }

    return uploads.size;
  }

  private async persistFailure(summary: AutoDevCaseSummary, error: unknown): Promise<void> {
    const caseId = summary.case_id;
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    fs.mkdirSync(workspaceDir, { recursive: true });
    const failure = {
      generatedAt: new Date().toISOString(),
      caseId,
      status: summary.status,
      error: String((error as any)?.message || error || 'Unknown error'),
    };
    fs.writeFileSync(path.join(workspaceDir, 'reviewer-failure.json'), JSON.stringify(failure, null, 2), 'utf-8');

    await this.client.appendEvent(caseId, {
      kind: 'reviewer_validation_failed',
      actor_id: 'reviewer',
      payload: failure,
    });
  }

  private normalizeReviewerOutput(
    output: AutoDevReviewerOutput | undefined,
    result: ReviewerAgentExecutionResult,
  ): AutoDevReviewerOutput {
    const decision = output?.decision === 'reopened' ? 'reopened' : 'closed';
    return {
      version: 1,
      summary: String(output?.summary || result.summary.overview || 'ReviewerCat completed validation.').trim(),
      overview: String(output?.overview || result.summary.overview || '').trim() || undefined,
      decision,
      decisionReason: String(output?.decisionReason || output?.summary || result.summary.overview || '').trim()
        || 'ReviewerCat completed the validation step.',
      nextState: output?.nextState === 'reopened' ? 'reopened' : decision,
      regressionStatus: output?.regressionStatus,
      riskLevel: output?.riskLevel,
      artifacts: Array.isArray(output?.artifacts) ? output!.artifacts : [],
      writebackPlan: output?.writebackPlan,
      metrics: output?.metrics,
    };
  }

  private async downloadArtifact(caseId: string, artifactsDir: string, artifact: AutoDevArtifactRecord): Promise<string> {
    const data = await this.client.downloadArtifact(artifact.artifact_id);
    const stageDir = path.join(artifactsDir, this.safeFileName(String(artifact.stage || 'input')));
    fs.mkdirSync(stageDir, { recursive: true });
    const baseName = this.safeFileName(
      artifact.original_filename
      || artifact.title
      || `${caseId}-${artifact.artifact_id}.${artifact.format || 'bin'}`,
    );
    const filePath = path.join(stageDir, `${artifact.artifact_id}-${baseName}`);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  private cleanupWorkspace(caseId: string): void {
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }

  private resolveWorkspacePath(workspaceDir: string, inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }
    return path.resolve(workspaceDir, inputPath);
  }

  private safeFileName(input: string): string {
    const basename = path.basename(input || 'artifact.bin');
    const sanitized = basename.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim();
    return sanitized || 'artifact.bin';
  }

  private async executeWriteback(
    workspaceDir: string,
    prepared: PreparedReviewerCase,
    writebackPlan: AutoDevWritebackPlan,
    decision: AutoDevReviewerOutput['decision'],
  ): Promise<AutoDevWritebackResult | undefined> {
    if (decision !== 'closed' || !writebackPlan.enabled) {
      return undefined;
    }

    const writebackResult = await this.writebackExecutor.execute({
      detail: prepared.detail,
      workspaceDir,
      downloadedArtifacts: prepared.downloadedArtifacts,
      writebackPlan,
    });

    await this.client.appendEvent(prepared.detail.case.case_id, {
      kind: `reviewer_writeback_${writebackResult.status}`,
      actor_id: 'reviewer',
      payload: {
        status: writebackResult.status,
        summary: writebackResult.summary,
        action_count: writebackResult.actionResults.length,
        applied_count: writebackResult.actionResults.filter(item => item.status === 'completed').length,
        failed_count: writebackResult.actionResults.filter(item => item.status === 'failed').length,
      },
    });

    return writebackResult;
  }

  private resolveRecommendedNextAction(
    output: AutoDevReviewerOutput,
    writebackPlan: AutoDevWritebackPlan,
    writebackResult?: AutoDevWritebackResult,
  ): string {
    if (output.decision !== 'closed') {
      return 'engineer_rework_required';
    }
    if (!writebackPlan.enabled) {
      return 'case_closed';
    }
    if (writebackResult?.status === 'completed') {
      return 'writeback_completed';
    }
    return 'manual_writeback_required';
  }
}

function findDownloadedArtifactPath(
  workspaceDir: string,
  artifacts: DownloadedArtifactManifestItem[],
  artifactType: string,
): string | undefined {
  const match = artifacts.find(item => item.type === artifactType);
  return match ? path.resolve(workspaceDir, match.localPath) : undefined;
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
