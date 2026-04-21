import * as fs from 'fs';
import * as path from 'path';
import { AutoDevCaseDetail, AutoDevCaseSummary, AutoDevClient, AutoDevArtifactRecord } from '../../../utils/autodev-client';
import {
  AutoDevEngineerArtifactDescriptor,
  AutoDevEngineerOutput,
  readJsonFile,
} from '../../../utils/autodev-loop-contract';
import { Logger } from '../../../utils/logger';
import {
  createEngineerExecutionExecutorFromEnv,
  EngineerAgentExecutionResult,
  EngineerExecutionExecutor,
  EngineerWorkspaceStore,
} from './engineer-agent-executor';

interface AutoDevEngineerWorkerOptions {
  workingDirectory?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  executionExecutor?: EngineerExecutionExecutor;
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

interface PreparedEngineerCase {
  detail: AutoDevCaseDetail;
  downloadedArtifacts: DownloadedArtifactManifestItem[];
}

export interface AutoDevEngineerRunResult {
  processed: number;
  skipped: boolean;
}

const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

class LocalEngineerWorkspaceStore implements EngineerWorkspaceStore {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  getCaseDir(caseId: string): string {
    return path.join(this.baseDir, caseId);
  }
}

export class AutoDevEngineerWorker {
  private readonly client: AutoDevClient;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly executionExecutor: EngineerExecutionExecutor;
  private readonly workspaceStore: EngineerWorkspaceStore;
  private readonly keepSuccessfulWorkdir: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: AutoDevEngineerWorkerOptions = {}) {
    this.client = options.client || new AutoDevClient();
    this.batchSize = options.batchSize || readNumberEnv('AUTODEV_ENGINEER_BATCH_SIZE', DEFAULT_BATCH_SIZE);
    this.pollIntervalMs = options.pollIntervalMs || readNumberEnv('AUTODEV_ENGINEER_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);
    this.executionExecutor = options.executionExecutor || createEngineerExecutionExecutorFromEnv();
    const workingDirectory = options.workingDirectory || process.cwd();
    this.workspaceStore = new LocalEngineerWorkspaceStore(
      path.resolve(workingDirectory, 'data', 'autodev-engineer-cases'),
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
      `[AutoDevEngineerWorker] scheduler started (poll=${this.pollIntervalMs}ms, base=${this.client.getBaseUrl()})`,
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
    Logger.info('[AutoDevEngineerWorker] scheduler stopped');
  }

  async runOnce(): Promise<AutoDevEngineerRunResult> {
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
      Logger.warning(`[AutoDevEngineerWorker] queue poll failed: ${String(error?.message || error)}`);
    } finally {
      this.running = false;
    }

    return { processed, skipped: false };
  }

  private async listPendingCases(): Promise<AutoDevCaseSummary[]> {
    const items = await this.client.listCases({
      owner: 'engineer',
      limit: this.batchSize * 3,
    });

    return items
      .filter(item => item.status === 'fixing' || item.status === 'reopened')
      .slice(0, this.batchSize);
  }

  private async processCase(summary: AutoDevCaseSummary): Promise<void> {
    const caseId = summary.case_id;
    let activeStatus = summary.status;
    let prepared: PreparedEngineerCase | null = null;

    try {
      if (summary.status === 'reopened') {
        await this.client.updateState(caseId, {
          from: 'reopened',
          to: 'fixing',
          actor_id: 'engineer',
          reason: 'EngineerCat resumed a reopened case.',
          category: summary.category || undefined,
          recommended_next_action: summary.recommended_next_action || undefined,
        });
        activeStatus = 'fixing';
      }

      await this.client.appendEvent(caseId, {
        kind: 'engineer_execution_started',
        actor_id: 'engineer',
        payload: {
          source_status: summary.status,
          active_status: activeStatus,
          category: summary.category || null,
        },
      });

      const detail = await this.client.getCaseDetail(caseId);
      prepared = await this.prepareCase(detail);
      const result = await this.executionExecutor.executeCase(prepared.detail, this.workspaceStore);
      const shouldCleanup = await this.persistExecution(activeStatus, prepared, result);
      if (shouldCleanup) {
        this.cleanupWorkspace(caseId);
      }
      Logger.info(`[AutoDevEngineerWorker] completed ${caseId}`);
    } catch (error: any) {
      await this.persistFailure(summary, activeStatus, error);
      Logger.error(`[AutoDevEngineerWorker] failed ${caseId}: ${String(error?.message || error)}`);
      if (prepared) {
        Logger.info(`[AutoDevEngineerWorker] kept workspace for failed case ${caseId}: ${this.workspaceStore.getCaseDir(caseId)}`);
      }
    }
  }

  private async prepareCase(detail: AutoDevCaseDetail): Promise<PreparedEngineerCase> {
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

  private async persistExecution(
    fromState: string,
    prepared: PreparedEngineerCase,
    result: EngineerAgentExecutionResult,
  ): Promise<boolean> {
    const caseId = prepared.detail.case.case_id;
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    fs.writeFileSync(path.join(workspaceDir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8');

    const output = result.outputFilePath
      ? readJsonFile<AutoDevEngineerOutput>(path.resolve(workspaceDir, result.outputFilePath))
      : readJsonFile<AutoDevEngineerOutput>(path.join(workspaceDir, 'engineer-output.json'));
    const uploadCount = await this.uploadExecutionArtifacts(prepared.detail, output);
    const nextState = output?.nextState === 'blocked' ? 'blocked' : 'reviewing';
    const reason = String(output?.summary || result.summary.overview || 'EngineerCat completed the implementation step.').trim();

    await this.client.appendEvent(caseId, {
      kind: 'engineer_execution_completed',
      actor_id: 'engineer',
      payload: {
        overview: result.summary.overview,
        artifact_count: uploadCount,
        next_state: nextState,
        result_type: output?.resultType || null,
        risk_level: output?.riskLevel || null,
      },
    });

    await this.client.updateState(caseId, {
      from: fromState,
      to: nextState,
      actor_id: 'engineer',
      reason,
      category: prepared.detail.case.category || undefined,
      recommended_next_action: output?.recommendedNextAction
        || (nextState === 'reviewing' ? 'review_engineer_output' : 'collect_more_signal'),
    });

    return nextState === 'reviewing' && !this.keepSuccessfulWorkdir;
  }

  private async uploadExecutionArtifacts(
    detail: AutoDevCaseDetail,
    output?: AutoDevEngineerOutput,
  ): Promise<number> {
    const caseId = detail.case.case_id;
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    const uploads = new Map<string, AutoDevEngineerArtifactDescriptor>();

    const implementationNotePath = path.join(workspaceDir, 'implementation.md');
    if (fs.existsSync(implementationNotePath)) {
      uploads.set(implementationNotePath, {
        path: implementationNotePath,
        type: 'implementation',
        stage: 'execution',
        title: 'Engineer implementation note',
        format: 'markdown',
      });
    }

    const outputPath = path.join(workspaceDir, 'engineer-output.json');
    if (fs.existsSync(outputPath)) {
      uploads.set(outputPath, {
        path: outputPath,
        type: 'implementation_summary',
        stage: 'execution',
        title: 'Engineer execution output',
        format: 'json',
        contentType: 'application/json',
      });
    }

    const patchPath = path.join(workspaceDir, 'implementation.patch');
    if (fs.existsSync(patchPath)) {
      uploads.set(patchPath, {
        path: patchPath,
        type: 'patch',
        stage: 'execution',
        title: 'Engineer implementation patch',
        format: 'diff',
        contentType: 'text/x-diff',
      });
    }

    for (const artifact of output?.artifacts || []) {
      const resolvedPath = this.resolveWorkspacePath(workspaceDir, artifact.path);
      if (!fs.existsSync(resolvedPath)) {
        continue;
      }
      uploads.set(resolvedPath, {
        path: resolvedPath,
        type: artifact.type || 'implementation',
        stage: artifact.stage || 'execution',
        title: artifact.title || path.basename(resolvedPath),
        format: artifact.format,
        contentType: artifact.contentType,
      });
    }

    for (const artifact of uploads.values()) {
      await this.client.uploadArtifact({
        caseId,
        filePath: artifact.path,
        type: artifact.type || 'implementation',
        stage: artifact.stage || 'execution',
        title: artifact.title || path.basename(artifact.path),
        producedByAgent: 'engineer',
        format: artifact.format,
        contentType: artifact.contentType,
        metadata: {
          source_role: 'engineer-cat',
          category: detail.case.category || null,
        },
      });
    }

    return uploads.size;
  }

  private async persistFailure(summary: AutoDevCaseSummary, activeStatus: string, error: unknown): Promise<void> {
    const caseId = summary.case_id;
    const workspaceDir = this.workspaceStore.getCaseDir(caseId);
    fs.mkdirSync(workspaceDir, { recursive: true });
    const failure = {
      generatedAt: new Date().toISOString(),
      caseId,
      status: activeStatus,
      error: String((error as any)?.message || error || 'Unknown error'),
    };
    fs.writeFileSync(path.join(workspaceDir, 'engineer-failure.json'), JSON.stringify(failure, null, 2), 'utf-8');

    await this.client.appendEvent(caseId, {
      kind: 'engineer_execution_failed',
      actor_id: 'engineer',
      payload: failure,
    });

    if (activeStatus === 'fixing') {
      try {
        await this.client.updateState(caseId, {
          from: 'fixing',
          to: 'blocked',
          actor_id: 'engineer',
          reason: failure.error,
          category: summary.category || undefined,
          recommended_next_action: 'engineer_failed_needs_follow_up',
        });
      } catch (transitionError: any) {
        Logger.warning(`[AutoDevEngineerWorker] failed to block case ${caseId}: ${String(transitionError?.message || transitionError)}`);
      }
    }
  }

  private async downloadArtifact(caseId: string, artifactsDir: string, artifact: AutoDevArtifactRecord): Promise<string> {
    const data = await this.client.downloadArtifact(artifact.artifact_id);
    const stageDir = path.join(artifactsDir, this.safeFileName(String(artifact.stage || 'input')));
    fs.mkdirSync(stageDir, { recursive: true });
    const localName = this.safeFileName(
      artifact.original_filename
      || artifact.title
      || `${caseId}-${artifact.artifact_id}.${artifact.format || 'bin'}`,
    );
    const filePath = path.join(stageDir, `${artifact.artifact_id}-${localName}`);
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
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
