import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../../utils/logger';
import { AutoDevClient, AutoDevLogDetail, AutoDevSessionLogSummary } from '../../../utils/autodev-client';
import { AutoDevInspectorHandoff, readJsonFile } from '../../../utils/autodev-loop-contract';
import { InspectorCaseRecord } from './inspector-case-store';
import {
  createInspectorReviewExecutorFromEnv,
  InspectorAgentReviewResult,
  InspectorReviewExecutor,
  InspectorWorkspaceStore,
} from './inspector-agent-review-executor';

interface AutoDevInspectorWorkerOptions {
  workingDirectory?: string;
  batchSize?: number;
  reviewExecutor?: InspectorReviewExecutor;
  client?: AutoDevClient;
  keepSuccessfulWorkdir?: boolean;
  dailyRunTime?: string;
}

interface PreparedInspectorLog {
  detail: AutoDevLogDetail;
  record: InspectorCaseRecord;
}

export interface AutoDevInspectorRunResult {
  processed: number;
  skipped: boolean;
}

const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_DAILY_RUN_TIME = '08:00';

class LocalInspectorWorkspaceStore implements InspectorWorkspaceStore {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  getCaseDir(caseId: string): string {
    return path.join(this.baseDir, caseId);
  }
}

export class AutoDevInspectorWorker {
  private readonly client: AutoDevClient;
  private readonly batchSize: number;
  private readonly reviewExecutor: InspectorReviewExecutor;
  private readonly workspaceStore: InspectorWorkspaceStore;
  private readonly keepSuccessfulWorkdir: boolean;
  private readonly dailyRunTime: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: AutoDevInspectorWorkerOptions = {}) {
    this.client = options.client || new AutoDevClient();
    this.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this.reviewExecutor = options.reviewExecutor || createInspectorReviewExecutorFromEnv();
    const workingDirectory = options.workingDirectory || process.cwd();
    this.workspaceStore = new LocalInspectorWorkspaceStore(
      path.resolve(workingDirectory, 'data', 'autodev-inspector-logs'),
    );
    this.keepSuccessfulWorkdir = options.keepSuccessfulWorkdir === true;
    this.dailyRunTime = this.normalizeDailyRunTime(options.dailyRunTime);
  }

  static isEnabled(): boolean {
    return new AutoDevClient().isConfigured();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    const nextRunAt = this.getNextRunAt(new Date());
    Logger.info(
      `[AutoDevInspectorWorker] daily scheduler started (time=${this.dailyRunTime}, next=${nextRunAt.toISOString()}, base=${this.client.getBaseUrl()})`,
    );
    this.scheduleNextRun(nextRunAt);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    Logger.info('[AutoDevInspectorWorker] scheduler stopped');
  }

  async runOnce(): Promise<AutoDevInspectorRunResult> {
    if (this.running || !this.client.isConfigured()) {
      return { processed: 0, skipped: true };
    }

    this.running = true;
    let processed = 0;
    try {
      const queue = await this.client.listPendingLogs('inspector', this.batchSize);
      for (const item of queue) {
        await this.processLog(item);
        processed += 1;
      }
    } catch (error: any) {
      Logger.warning(`[AutoDevInspectorWorker] queue poll failed: ${String(error?.message || error)}`);
    } finally {
      this.running = false;
    }

    return { processed, skipped: false };
  }

  private async processLog(log: AutoDevSessionLogSummary): Promise<void> {
    const logId = log.log_id;
    const detail = await this.client.getLogDetail(logId);
    const workspaceDir = this.workspaceStore.getCaseDir(logId);

    await this.client.appendLogEvent(logId, {
      agent: 'inspector',
      kind: 'inspector_review_started',
      payload: {
        filename: detail.log.filename,
        session_type: detail.log.session_type,
        session_id: detail.log.session_id,
      },
    });

    let prepared: PreparedInspectorLog | null = null;
    try {
      prepared = await this.prepareLog(detail);
      const result = await this.reviewExecutor.reviewCase(prepared.record, this.workspaceStore);
      await this.persistReview(prepared.record, prepared.detail, result);
      this.cleanupWorkspace(logId);
      Logger.info(`[AutoDevInspectorWorker] completed ${logId}`);
    } catch (error: any) {
      const fallback = prepared || this.createFallbackRecord(detail);
      await this.persistFailure(fallback.record, fallback.detail, error);
      Logger.error(`[AutoDevInspectorWorker] failed ${logId}: ${String(error?.message || error)}`);
    } finally {
      if (this.keepSuccessfulWorkdir && fs.existsSync(workspaceDir)) {
        Logger.info(`[AutoDevInspectorWorker] kept workspace for ${logId}: ${workspaceDir}`);
      }
    }
  }

  private async prepareLog(detail: AutoDevLogDetail): Promise<PreparedInspectorLog> {
    const logId = detail.log.log_id;
    const workspaceDir = this.workspaceStore.getCaseDir(logId);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    const rawDir = path.join(workspaceDir, 'logs');
    fs.mkdirSync(rawDir, { recursive: true });

    const fileName = this.safeFileName(detail.log.filename || `${logId}.jsonl`);
    const relativePath = path.join('logs', fileName).replace(/\\/g, '/');
    const absolutePath = path.join(workspaceDir, relativePath);
    const content = await this.client.downloadLog(logId);
    fs.writeFileSync(absolutePath, content);
    fs.writeFileSync(path.join(workspaceDir, 'autodev-log.json'), JSON.stringify(detail.log, null, 2), 'utf-8');

    const now = new Date().toISOString();
    const record: InspectorCaseRecord = {
      caseId: logId,
      createdAt: detail.log.uploaded_at || now,
      analysisType: 'runtime',
      status: 'received',
      source: `autodev:${detail.log.session_type}`,
      userRequest: `session_id=${detail.log.session_id}`,
      runtimeVersion: undefined,
      fileCount: 1,
      storedPath: workspaceDir,
      files: [
        {
          path: relativePath,
          kind: 'session_jsonl',
          size: content.length,
        },
      ],
      updatedAt: detail.log.uploaded_at || now,
    };

    return { detail, record };
  }

  private createFallbackRecord(detail: AutoDevLogDetail): PreparedInspectorLog {
    const logId = detail.log.log_id;
    const now = new Date().toISOString();
    return {
      detail,
      record: {
        caseId: logId,
        createdAt: detail.log.uploaded_at || now,
        analysisType: 'runtime',
        status: 'failed',
        source: `autodev:${detail.log.session_type}`,
        userRequest: `session_id=${detail.log.session_id}`,
        runtimeVersion: undefined,
        fileCount: 0,
        storedPath: this.workspaceStore.getCaseDir(logId),
        files: [],
        updatedAt: now,
      },
    };
  }

  private async persistReview(record: InspectorCaseRecord, detail: AutoDevLogDetail, result: InspectorAgentReviewResult): Promise<void> {
    const workspaceDir = this.workspaceStore.getCaseDir(record.caseId);
    const resultPath = path.join(workspaceDir, 'result.json');
    const reportPath = result.reportFilePath
      ? path.resolve(workspaceDir, result.reportFilePath)
      : path.join(workspaceDir, 'agent-review.md');
    const reportMarkdown = fs.existsSync(reportPath)
      ? fs.readFileSync(reportPath, 'utf-8')
      : undefined;
    const handoffPath = path.join(workspaceDir, 'autodev-handoff.json');
    const handoff = readJsonFile<AutoDevInspectorHandoff>(handoffPath);
    const createdCaseId = await this.createAutoDevCaseFromReview(record, detail, reportPath, handoffPath, handoff);

    fs.writeFileSync(resultPath, JSON.stringify({
      ...result,
      autodevCaseId: createdCaseId,
    }, null, 2), 'utf-8');

    await this.client.appendLogCard(record.caseId, {
      agent: 'inspector',
      card_type: 'issue',
      title: `Inspector review for ${detail.log.filename}`,
      summary: result.summary.overview,
      severity: 'info',
      status: 'open',
      payload: {
        mode: result.mode,
        delivery_count: result.summary.deliveryCount,
        report_generated: result.summary.reportGenerated,
        final_text: result.finalText,
        report_markdown: reportMarkdown,
        autodev_case_id: createdCaseId,
      },
    });

    await this.client.appendLogEvent(record.caseId, {
      agent: 'inspector',
      kind: 'inspector_review_completed',
      payload: {
        overview: result.summary.overview,
        delivery_count: result.summary.deliveryCount,
        report_generated: result.summary.reportGenerated,
        mode: result.mode,
        autodev_case_id: createdCaseId,
      },
    });
  }

  private async persistFailure(record: InspectorCaseRecord, detail: AutoDevLogDetail, error: unknown): Promise<void> {
    const workspaceDir = this.workspaceStore.getCaseDir(record.caseId);
    fs.mkdirSync(workspaceDir, { recursive: true });
    const failure = {
      generatedAt: new Date().toISOString(),
      logId: record.caseId,
      filename: detail.log.filename,
      error: String((error as any)?.message || error || 'Unknown error'),
    };
    fs.writeFileSync(path.join(workspaceDir, 'inspector-failure.json'), JSON.stringify(failure, null, 2), 'utf-8');

    await this.client.appendLogCard(record.caseId, {
      agent: 'inspector',
      card_type: 'failure',
      title: `Inspector failed for ${detail.log.filename}`,
      summary: failure.error,
      severity: 'high',
      status: 'open',
      payload: failure,
    });

    await this.client.appendLogEvent(record.caseId, {
      agent: 'inspector',
      kind: 'inspector_review_failed',
      payload: failure,
    });
  }

  private cleanupWorkspace(logId: string): void {
    if (this.keepSuccessfulWorkdir) {
      return;
    }
    const workspaceDir = this.workspaceStore.getCaseDir(logId);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }

  private safeFileName(input: string): string {
    const basename = path.basename(input || 'session.jsonl');
    const sanitized = basename.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim();
    return sanitized || 'session.jsonl';
  }

  private async createAutoDevCaseFromReview(
    record: InspectorCaseRecord,
    detail: AutoDevLogDetail,
    reportPath: string,
    handoffPath: string,
    handoff?: AutoDevInspectorHandoff,
  ): Promise<string | undefined> {
    if (!handoff || handoff.shouldCreateCase === false) {
      return undefined;
    }

    const summary = String(handoff.summary || '').trim();
    if (!summary) {
      Logger.warning(`[AutoDevInspectorWorker] skip case creation for ${record.caseId}: handoff summary missing`);
      return undefined;
    }

    const created = await this.client.createCase({
      title: String(handoff.title || `Inspector finding for ${detail.log.filename}`).trim(),
      source: 'xiaoba_inspector',
      source_session_id: detail.log.session_id,
      summary,
      priority: String(handoff.priority || 'normal').trim() || 'normal',
      labels: Array.from(new Set([
        'autodev',
        'inspector',
        ...(handoff.labels || []).map(item => String(item || '').trim()).filter(Boolean),
      ])),
      category: handoff.category,
      recommended_next_action: handoff.recommendedNextAction || defaultRecommendedAction(handoff.category),
    });

    const rawLogPath = path.join(this.workspaceStore.getCaseDir(record.caseId), record.files[0]?.path || '');
    if (fs.existsSync(rawLogPath)) {
      await this.client.uploadArtifact({
        caseId: created.case_id,
        filePath: rawLogPath,
        type: /\.jsonl$/i.test(rawLogPath) ? 'raw_jsonl' : 'raw_log',
        stage: 'input',
        title: detail.log.filename || path.basename(rawLogPath),
        producedByAgent: 'inspector',
      });
    }

    if (fs.existsSync(reportPath)) {
      await this.client.uploadArtifact({
        caseId: created.case_id,
        filePath: reportPath,
        type: 'assessment',
        stage: 'analysis',
        title: 'Inspector assessment',
        producedByAgent: 'inspector',
        format: 'markdown',
        contentType: 'text/markdown',
      });
    }

    if (fs.existsSync(handoffPath)) {
      await this.client.uploadArtifact({
        caseId: created.case_id,
        filePath: handoffPath,
        type: 'handoff',
        stage: 'analysis',
        title: 'Inspector handoff to EngineerCat',
        producedByAgent: 'inspector',
        format: 'json',
        contentType: 'application/json',
      });
    }

    await this.client.appendEvent(created.case_id, {
      kind: 'inspector_case_linked_to_log',
      actor_id: 'inspector',
      payload: {
        log_id: record.caseId,
        source_session_id: detail.log.session_id,
        filename: detail.log.filename,
      },
    });

    await this.client.updateState(created.case_id, {
      from: 'new',
      to: 'inspecting',
      actor_id: 'inspector',
      reason: 'Inspector assessment artifacts uploaded.',
      category: handoff.category,
      recommended_next_action: handoff.recommendedNextAction || defaultRecommendedAction(handoff.category),
    });

    await this.client.updateState(created.case_id, {
      from: 'inspecting',
      to: handoff.nextState,
      actor_id: 'inspector',
      reason: summary,
      category: handoff.category,
      recommended_next_action: handoff.recommendedNextAction || defaultRecommendedAction(handoff.category),
    });

    await this.client.appendLogEvent(record.caseId, {
      agent: 'inspector',
      kind: 'autodev_case_created',
      payload: {
        case_id: created.case_id,
        next_state: handoff.nextState,
        category: handoff.category,
      },
    });

    return created.case_id;
  }

  private scheduleNextRun(nextRunAt: Date): void {
    const delayMs = Math.max(nextRunAt.getTime() - Date.now(), 1000);
    this.timer = setTimeout(() => {
      void this.runScheduledBatch();
    }, delayMs);
  }

  private async runScheduledBatch(): Promise<void> {
    this.timer = null;
    try {
      await this.runOnce();
    } finally {
      this.scheduleNextRun(this.getNextRunAt(new Date()));
    }
  }

  private normalizeDailyRunTime(value?: string): string {
    const candidate = String(value || process.env.AUTODEV_INSPECTOR_DAILY_TIME || DEFAULT_DAILY_RUN_TIME).trim();
    return /^\d{2}:\d{2}$/.test(candidate) ? candidate : DEFAULT_DAILY_RUN_TIME;
  }

  private getNextRunAt(now: Date): Date {
    const [hours, minutes] = this.dailyRunTime.split(':').map(value => parseInt(value, 10));
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }
}

function defaultRecommendedAction(category: string): string {
  switch (category) {
    case 'runtime_bug':
      return 'runtime_fix';
    case 'new_skill_candidate':
      return 'extract_skill';
    case 'skill_fix':
      return 'repair_skill';
    default:
      return 'collect_more_signal';
  }
}
