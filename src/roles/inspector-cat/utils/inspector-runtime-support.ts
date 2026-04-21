import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Logger } from '../../../utils/logger';
import { InspectorReviewJob } from '../inspector-case-worker';
import { InspectorReviewExecutor } from './inspector-agent-review-executor';
import { InspectorCaseStore } from './inspector-case-store';
import { createInspectorApiRouter } from './inspector-api-router';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3800;
const DEFAULT_BODY_LIMIT = '50mb';

export interface InspectorRuntimeSupportOptions {
  workingDirectory?: string;
  host?: string;
  port?: number;
  bodyLimit?: string;
  workerEnabled?: boolean;
  pollIntervalMs?: number;
  caseStore?: InspectorCaseStore;
  reviewExecutor?: InspectorReviewExecutor;
}

export class InspectorRuntimeSupport {
  private readonly store: InspectorCaseStore;
  private readonly workingDirectory: string;
  private readonly host: string;
  private readonly port: number;
  private readonly bodyLimit: string;
  private readonly worker: InspectorReviewJob | null;
  private server: Server | null = null;

  constructor(options: InspectorRuntimeSupportOptions = {}) {
    this.store = options.caseStore || new InspectorCaseStore();
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.host = options.host || process.env.INSPECTOR_SERVER_HOST || DEFAULT_HOST;
    this.port = Number.isFinite(options.port)
      ? Number(options.port)
      : Number(process.env.INSPECTOR_SERVER_PORT || DEFAULT_PORT);
    this.bodyLimit = options.bodyLimit || process.env.XIAOBA_API_BODY_LIMIT || DEFAULT_BODY_LIMIT;

    const workerEnabled = options.workerEnabled ?? (process.env.INSPECTOR_WORKER_ENABLED !== 'false');
    this.worker = workerEnabled
      ? new InspectorReviewJob({
        store: this.store,
        pollIntervalMs: options.pollIntervalMs,
        reviewExecutor: options.reviewExecutor,
      })
      : null;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const app = express();
    app.use(express.json({ limit: this.bodyLimit }));
    app.use('/api', createInspectorApiRouter(this.store));

    this.server = await new Promise<Server>((resolve, reject) => {
      const server = app.listen(this.port, this.host, () => resolve(server));
      server.on('error', reject);
    });

    this.worker?.start();
    Logger.info(`[InspectorHookRuntime] inbox listening on ${this.getBaseUrl()} (body limit=${this.bodyLimit})`);
    if (!this.worker) {
      Logger.info('[InspectorHookRuntime] review hook disabled');
    }
  }

  async stop(): Promise<void> {
    this.worker?.stop();

    if (!this.server) {
      return;
    }

    const activeServer = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      activeServer.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    Logger.info('[InspectorHookRuntime] inbox stopped');
  }

  getBaseUrl(): string {
    const address = this.server?.address();
    if (address && typeof address === 'object') {
      const host = address.address === '::' ? '127.0.0.1' : address.address;
      return `http://${host}:${address.port}`;
    }
    return `http://${this.host}:${this.port}`;
  }

  getPort(): number {
    const address = this.server?.address() as AddressInfo | null;
    return address?.port || this.port;
  }
}

export type InspectorHookRuntimeOptions = InspectorRuntimeSupportOptions;
export class InspectorHookRuntime extends InspectorRuntimeSupport {}
