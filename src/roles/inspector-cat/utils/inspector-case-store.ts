import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../../utils/logger';
import { InspectorRemoteArchive } from './inspector-remote-archive';

export type InspectorCaseStatus = 'uploading' | 'received' | 'processing' | 'analyzed' | 'failed';

export interface InspectorUploadFileInput {
  path: string;
  contentBase64: string;
  kind?: 'runtime_log' | 'session_jsonl' | 'manifest' | 'case_markdown' | 'other';
}

export interface InspectorBinaryFileInput {
  path: string;
  content: Buffer;
  kind?: 'runtime_log' | 'session_jsonl' | 'manifest' | 'case_markdown' | 'other';
}

export interface InspectorCaseCreateInput {
  analysisType: 'runtime' | 'skill' | 'auto';
  source?: string;
  userRequest?: string;
  runtimeVersion?: string;
  client?: Record<string, unknown>;
  manifest?: unknown;
  caseMarkdown?: string;
  files?: InspectorUploadFileInput[];
}

export interface InspectorCaseSummary {
  caseId: string;
  createdAt: string;
  analysisType: 'runtime' | 'skill' | 'auto';
  status: InspectorCaseStatus;
  source?: string;
  userRequest?: string;
  runtimeVersion?: string;
  fileCount: number;
  storedPath: string;
}

export interface InspectorCaseRecord extends InspectorCaseSummary {
  client?: Record<string, unknown>;
  manifestPath?: string;
  caseMarkdownPath?: string;
  files: Array<{ path: string; kind?: string; size: number }>;
  resultSummary?: string;
  resultPath?: string;
  updatedAt: string;
}

const DEFAULT_CASE_DIR = path.resolve('data/inspector-cases');

export class InspectorCaseStore {
  private readonly remoteArchive: InspectorRemoteArchive;

  constructor(
    private readonly baseDir: string = DEFAULT_CASE_DIR,
    remoteArchive: InspectorRemoteArchive = new InspectorRemoteArchive(),
  ) {
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.remoteArchive = remoteArchive;
  }

  async createCase(input: InspectorCaseCreateInput): Promise<InspectorCaseSummary> {
    const createdAt = new Date().toISOString();
    const caseId = this.generateCaseId();
    const caseDir = path.join(this.baseDir, caseId);
    const attachmentsDir = path.join(caseDir, 'files');

    fs.mkdirSync(attachmentsDir, { recursive: true });

    let manifestPath: string | undefined;
    if (input.manifest !== undefined) {
      manifestPath = path.join(caseDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(input.manifest, null, 2), 'utf-8');
    }

    let caseMarkdownPath: string | undefined;
    if (input.caseMarkdown) {
      caseMarkdownPath = path.join(caseDir, 'case.md');
      fs.writeFileSync(caseMarkdownPath, input.caseMarkdown, 'utf-8');
    }

    const savedFiles: InspectorCaseRecord['files'] = [];
    for (const file of input.files || []) {
      savedFiles.push(this.saveBinaryFile(attachmentsDir, caseDir, {
        path: file.path,
        kind: file.kind,
        content: Buffer.from(file.contentBase64, 'base64'),
      }));
    }

    const initialStatus: InspectorCaseStatus = savedFiles.length > 0 ? 'received' : 'uploading';

    const record: InspectorCaseRecord = {
      caseId,
      createdAt,
      analysisType: input.analysisType,
      status: initialStatus,
      source: input.source,
      userRequest: input.userRequest,
      runtimeVersion: input.runtimeVersion,
      fileCount: savedFiles.length,
      storedPath: caseDir,
      client: input.client,
      manifestPath: manifestPath ? path.relative(caseDir, manifestPath).replace(/\\/g, '/') : undefined,
      caseMarkdownPath: caseMarkdownPath ? path.relative(caseDir, caseMarkdownPath).replace(/\\/g, '/') : undefined,
      files: savedFiles,
      updatedAt: createdAt,
    };

    this.writeCaseRecord(caseDir, record);
    await this.syncRemote(record, caseDir, 'createCase');
    return this.toSummary(record);
  }

  async listCases(limit: number = 50): Promise<InspectorCaseSummary[]> {
    const remote = await this.tryRemote(() => this.remoteArchive.listCases(limit), 'listCases');
    if (remote) {
      return remote;
    }
    return this.listCasesLocal(limit);
  }

  async getCase(caseId: string): Promise<InspectorCaseRecord | null> {
    const remote = await this.tryRemote(() => this.remoteArchive.getCase(caseId), 'getCase');
    if (remote) {
      return remote;
    }
    return this.readCaseRecord(caseId);
  }

  async listCasesByStatus(status: InspectorCaseStatus, limit: number = 50): Promise<InspectorCaseSummary[]> {
    const remote = await this.tryRemote(() => this.remoteArchive.listCasesByStatus(status, limit), 'listCasesByStatus');
    if (remote) {
      return remote;
    }
    return this.listCaseRecords(limit)
      .filter(record => record.status === status)
      .map(record => this.toSummary(record));
  }

  async updateCaseStatus(caseId: string, status: InspectorCaseStatus, resultSummary?: string): Promise<InspectorCaseRecord> {
    const record = this.readCaseRecord(caseId);
    if (!record) {
      throw new Error(`Case not found: ${caseId}`);
    }

    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (resultSummary !== undefined) {
      record.resultSummary = resultSummary;
    }

    const caseDir = path.join(this.baseDir, caseId);
    this.writeCaseRecord(caseDir, record);
    await this.syncRemote(record, caseDir, 'updateCaseStatus');
    return record;
  }

  getCaseDir(caseId: string): string {
    return path.join(this.baseDir, caseId);
  }

  async appendFile(caseId: string, file: InspectorBinaryFileInput): Promise<InspectorCaseRecord> {
    const record = this.readCaseRecord(caseId);
    if (!record) {
      throw new Error(`Case not found: ${caseId}`);
    }

    const caseDir = path.join(this.baseDir, caseId);
    const attachmentsDir = path.join(caseDir, 'files');
    const saved = this.saveBinaryFile(attachmentsDir, caseDir, file);

    const existingIndex = record.files.findIndex(existing => existing.path === saved.path);
    if (existingIndex >= 0) {
      record.files[existingIndex] = saved;
    } else {
      record.files.push(saved);
    }

    record.fileCount = record.files.length;
    record.updatedAt = new Date().toISOString();
    this.writeCaseRecord(caseDir, record);
    await this.syncRemote(record, caseDir, 'appendFile');
    return record;
  }

  async completeCaseUpload(caseId: string): Promise<InspectorCaseRecord> {
    const record = this.readCaseRecord(caseId);
    if (!record) {
      throw new Error(`Case not found: ${caseId}`);
    }

    if (record.fileCount <= 0) {
      throw new Error(`Case ${caseId} has no uploaded files`);
    }

    if (record.status === 'uploading') {
      record.status = 'received';
      record.updatedAt = new Date().toISOString();
      const caseDir = path.join(this.baseDir, caseId);
      this.writeCaseRecord(caseDir, record);
      await this.syncRemote(record, caseDir, 'completeCaseUpload');
    }

    return record;
  }

  async saveResult(
    caseId: string,
    status: Exclude<InspectorCaseStatus, 'uploading' | 'received'>,
    result: unknown,
    resultSummary?: string,
  ): Promise<InspectorCaseRecord> {
    const record = this.readCaseRecord(caseId);
    if (!record) {
      throw new Error(`Case not found: ${caseId}`);
    }

    const caseDir = path.join(this.baseDir, caseId);
    const resultPath = path.join(caseDir, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');

    record.status = status;
    record.resultSummary = resultSummary;
    record.resultPath = path.relative(caseDir, resultPath).replace(/\\/g, '/');
    record.updatedAt = new Date().toISOString();

    this.writeCaseRecord(caseDir, record);
    await this.syncRemote(record, caseDir, 'saveResult');
    return record;
  }

  async getResult(caseId: string): Promise<unknown | null> {
    const remote = await this.tryRemote(() => this.remoteArchive.getResult(caseId), 'getResult');
    if (remote) {
      return remote;
    }

    const record = this.readCaseRecord(caseId);
    if (!record?.resultPath) return null;

    const resultPath = path.join(this.baseDir, caseId, record.resultPath);
    if (!fs.existsSync(resultPath)) return null;

    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  }

  private listCasesLocal(limit: number = 50): InspectorCaseSummary[] {
    if (!fs.existsSync(this.baseDir)) return [];

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.readCaseRecord(entry.name))
      .filter((record): record is InspectorCaseRecord => !!record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return entries.slice(0, Math.max(1, limit)).map(record => this.toSummary(record));
  }

  private generateCaseId(): string {
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const random = Math.random().toString(36).slice(2, 8);
    return `case-${timestamp}-${random}`;
  }

  private normalizeRelativeUploadPath(inputPath: string): string {
    const normalized = inputPath.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);

    if (parts.length === 0) {
      throw new Error('Uploaded file path is empty');
    }

    if (parts.some(part => part === '.' || part === '..')) {
      throw new Error(`Unsafe uploaded file path: ${inputPath}`);
    }

    return parts.join('/');
  }

  private saveBinaryFile(
    attachmentsDir: string,
    caseDir: string,
    file: InspectorBinaryFileInput,
  ): { path: string; kind?: string; size: number } {
    const safeRelativePath = this.normalizeRelativeUploadPath(file.path);
    const targetPath = path.join(attachmentsDir, safeRelativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content);

    return {
      path: path.relative(caseDir, targetPath).replace(/\\/g, '/'),
      kind: file.kind,
      size: file.content.length,
    };
  }

  private readCaseRecord(caseId: string): InspectorCaseRecord | null {
    if (!/^case-[a-z0-9-]+$/i.test(caseId)) return null;

    const caseFile = path.join(this.baseDir, caseId, 'case.json');
    if (!fs.existsSync(caseFile)) return null;

    return JSON.parse(fs.readFileSync(caseFile, 'utf-8')) as InspectorCaseRecord;
  }

  private listCaseRecords(limit: number = 50): InspectorCaseRecord[] {
    if (!fs.existsSync(this.baseDir)) return [];

    return fs.readdirSync(this.baseDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.readCaseRecord(entry.name))
      .filter((record): record is InspectorCaseRecord => !!record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit));
  }

  private writeCaseRecord(caseDir: string, record: InspectorCaseRecord): void {
    fs.writeFileSync(path.join(caseDir, 'case.json'), JSON.stringify(record, null, 2), 'utf-8');
  }

  private toSummary(record: InspectorCaseRecord): InspectorCaseSummary {
    return {
      caseId: record.caseId,
      createdAt: record.createdAt,
      analysisType: record.analysisType,
      status: record.status,
      source: record.source,
      userRequest: record.userRequest,
      runtimeVersion: record.runtimeVersion,
      fileCount: record.fileCount,
      storedPath: record.storedPath,
    };
  }

  private async syncRemote(record: InspectorCaseRecord, caseDir: string, action: string): Promise<void> {
    try {
      await this.remoteArchive.syncCase(record, caseDir);
    } catch (error: any) {
      const message = `[InspectorStorage] ${action} remote sync failed for ${record.caseId}: ${String(error?.message || error)}`;
      if (this.remoteArchive.isRequired()) {
        throw error;
      }
      Logger.warning(message);
    }
  }

  private async tryRemote<T>(reader: () => Promise<T | null>, action: string): Promise<T | null> {
    try {
      return await reader();
    } catch (error: any) {
      const message = `[InspectorStorage] ${action} remote read failed: ${String(error?.message || error)}`;
      if (this.remoteArchive.isRequired()) {
        throw error;
      }
      Logger.warning(message);
      return null;
    }
  }
}
