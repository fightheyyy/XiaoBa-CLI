import { Logger } from '../../utils/logger';
import { InspectorCaseRecord, InspectorCaseStore } from './utils/inspector-case-store';
import {
  buildInspectorReviewArtifactManifest,
  createInspectorReviewExecutorFromEnv,
  InspectorAgentReviewResult,
  InspectorReviewExecutor,
} from './utils/inspector-agent-review-executor';

interface InspectorCaseWorkerOptions {
  store?: InspectorCaseStore;
  pollIntervalMs?: number;
  batchSize?: number;
  reviewExecutor?: InspectorReviewExecutor;
}

export class InspectorCaseWorker {
  private readonly store: InspectorCaseStore;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly reviewExecutor: InspectorReviewExecutor;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: InspectorCaseWorkerOptions = {}) {
    this.store = options.store || new InspectorCaseStore();
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.batchSize = options.batchSize || 3;
    this.reviewExecutor = options.reviewExecutor || createInspectorReviewExecutorFromEnv();
  }

  start(): void {
    if (this.timer) return;
    Logger.info(`[InspectorReviewJob] scheduler started (poll=${this.pollIntervalMs}ms)`);
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
    Logger.info('[InspectorReviewJob] scheduler stopped');
  }

  getStatus(): { running: boolean; pollIntervalMs: number; queueSize: number } {
    return {
      running: !!this.timer || this.running,
      pollIntervalMs: this.pollIntervalMs,
      queueSize: 0,
    };
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const queue = await this.store.listCasesByStatus('received', this.batchSize);
      for (const item of queue) {
        await this.processCase(item.caseId);
      }
    } finally {
      this.running = false;
    }
  }

  private async processCase(caseId: string): Promise<void> {
    const record = await this.store.getCase(caseId);
    if (!record || record.status !== 'received') {
      return;
    }

    try {
      await this.store.updateCaseStatus(caseId, 'processing', 'Inspector hook received the logs and queued a review job');
      const result = await this.reviewExecutor.reviewCase(record, this.store);
      const caseDir = this.store.getCaseDir(caseId);
      const enrichedResult = this.withArtifactManifest(result, caseDir);
      await this.store.saveResult(caseId, 'analyzed', enrichedResult, enrichedResult.summary.overview);
      Logger.info(`[InspectorReviewJob] completed ${caseId}`);
    } catch (error: any) {
      const failure = {
        generatedAt: new Date().toISOString(),
        caseId,
        error: String(error?.message || error || 'Unknown error'),
      };
      await this.store.saveResult(caseId, 'failed', failure, `Inspector review failed: ${failure.error}`);
      Logger.error(`[InspectorReviewJob] failed ${caseId}: ${failure.error}`);
    }
  }

  private withArtifactManifest(result: InspectorAgentReviewResult, caseDir: string): InspectorAgentReviewResult {
    const generatedManifest = buildInspectorReviewArtifactManifest({
      caseDir,
      reportFilePath: result.reportFilePath,
      handoffFilePath: result.handoffFilePath,
      deliveries: result.deliveries,
    });
    const existingManifest = Array.isArray(result.artifact_manifest) ? result.artifact_manifest : [];
    if (existingManifest.length === 0 && generatedManifest.length === 0) {
      return result;
    }

    const seen = new Set<string>();
    const artifact_manifest = [...existingManifest, ...generatedManifest].filter(item => {
      const key = `${item.path}\0${item.action}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      ...result,
      artifact_manifest,
    };
  }
}

export class InspectorReviewJob extends InspectorCaseWorker {}
