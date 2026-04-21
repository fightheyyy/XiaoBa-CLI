import * as fs from 'fs';
import * as path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { Logger } from '../../../utils/logger';
import {
  InspectorPersistenceConfig,
  resolveInspectorPersistenceConfig,
} from './inspector-storage-config';
import type { InspectorCaseRecord, InspectorCaseSummary } from './inspector-case-store';

type InspectorFileKind = 'runtime_log' | 'session_jsonl' | 'manifest' | 'case_markdown' | 'other';

interface CaseRow extends RowDataPacket {
  record_json: string;
  result_json: string | null;
}

interface FileRow extends RowDataPacket {
  relative_path: string;
  kind: string | null;
  size: number;
}

export class InspectorRemoteArchive {
  private readonly config: InspectorPersistenceConfig;
  private readonly mysqlPool: Pool | null;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(config: InspectorPersistenceConfig = resolveInspectorPersistenceConfig()) {
    this.config = config;
    this.mysqlPool = config.mysql
      ? mysql.createPool({
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
        connectionLimit: 10,
        waitForConnections: true,
        charset: 'utf8mb4',
      })
      : null;
  }

  isEnabled(): boolean {
    return !!this.mysqlPool;
  }

  isRequired(): boolean {
    return this.config.remoteRequired;
  }

  async syncCase(record: InspectorCaseRecord, caseDir: string): Promise<void> {
    if (!this.mysqlPool) {
      return;
    }

    await this.ensureInitialized();
    await this.upsertCaseRecord(record, caseDir);
  }

  async listCases(limit: number): Promise<InspectorCaseSummary[] | null> {
    if (!this.mysqlPool) {
      return null;
    }

    await this.ensureInitialized();
    const normalizedLimit = Math.max(1, Math.floor(limit || 50));
    const [rows] = await this.mysqlPool.query<CaseRow[]>(
      'SELECT record_json FROM inspector_cases ORDER BY created_at DESC LIMIT ?',
      [normalizedLimit],
    );
    return rows.map(row => this.toSummary(JSON.parse(row.record_json) as InspectorCaseRecord));
  }

  async getCase(caseId: string): Promise<InspectorCaseRecord | null> {
    if (!this.mysqlPool) {
      return null;
    }

    await this.ensureInitialized();
    const [rows] = await this.mysqlPool.query<CaseRow[]>(
      'SELECT record_json FROM inspector_cases WHERE case_id = ? LIMIT 1',
      [caseId],
    );
    if (rows.length === 0) {
      return null;
    }

    const record = JSON.parse(rows[0].record_json) as InspectorCaseRecord;
    record.files = await this.loadCaseFiles(caseId, record.files);
    return record;
  }

  async listCasesByStatus(status: string, limit: number): Promise<InspectorCaseSummary[] | null> {
    if (!this.mysqlPool) {
      return null;
    }

    await this.ensureInitialized();
    const normalizedLimit = Math.max(1, Math.floor(limit || 50));
    const [rows] = await this.mysqlPool.query<CaseRow[]>(
      'SELECT record_json FROM inspector_cases WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      [status, normalizedLimit],
    );
    return rows.map(row => this.toSummary(JSON.parse(row.record_json) as InspectorCaseRecord));
  }

  async getResult(caseId: string): Promise<unknown | null> {
    if (!this.mysqlPool) {
      return null;
    }

    await this.ensureInitialized();
    const [rows] = await this.mysqlPool.query<CaseRow[]>(
      'SELECT result_json FROM inspector_cases WHERE case_id = ? LIMIT 1',
      [caseId],
    );
    if (rows.length === 0 || !rows[0].result_json) {
      return null;
    }
    return JSON.parse(rows[0].result_json);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    this.initializationPromise = (async () => {
      if (this.mysqlPool) {
        await this.ensureMySqlSchema();
      }
      this.initialized = true;
      Logger.info(`[InspectorStorage] remote archive enabled (mysql=${!!this.mysqlPool})`);
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async ensureMySqlSchema(): Promise<void> {
    if (!this.mysqlPool) {
      return;
    }

    await this.mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS inspector_cases (
        case_id VARCHAR(64) NOT NULL PRIMARY KEY,
        analysis_type VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL,
        source VARCHAR(255) NULL,
        user_request TEXT NULL,
        runtime_version VARCHAR(255) NULL,
        file_count INT NOT NULL DEFAULT 0,
        stored_path TEXT NOT NULL,
        manifest_path TEXT NULL,
        case_markdown_path TEXT NULL,
        result_path TEXT NULL,
        result_summary TEXT NULL,
        record_json LONGTEXT NOT NULL,
        result_json LONGTEXT NULL,
        client_json LONGTEXT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        KEY idx_inspector_cases_status_created (status, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS inspector_case_files (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        case_id VARCHAR(64) NOT NULL,
        relative_path VARCHAR(1024) NOT NULL,
        kind VARCHAR(64) NULL,
        size BIGINT NOT NULL DEFAULT 0,
        uploaded_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        UNIQUE KEY uniq_case_path (case_id, relative_path),
        KEY idx_case_files_case_id (case_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  private async upsertCaseRecord(
    record: InspectorCaseRecord,
    caseDir: string,
  ): Promise<void> {
    if (!this.mysqlPool) {
      return;
    }

    const resultJson = record.resultPath
      ? this.tryReadJson(path.join(caseDir, record.resultPath))
      : null;

    await this.mysqlPool.query(
      `
        INSERT INTO inspector_cases (
          case_id, analysis_type, status, source, user_request, runtime_version,
          file_count, stored_path, manifest_path, case_markdown_path, result_path,
          result_summary, record_json, result_json, client_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          analysis_type = VALUES(analysis_type),
          status = VALUES(status),
          source = VALUES(source),
          user_request = VALUES(user_request),
          runtime_version = VALUES(runtime_version),
          file_count = VALUES(file_count),
          stored_path = VALUES(stored_path),
          manifest_path = VALUES(manifest_path),
          case_markdown_path = VALUES(case_markdown_path),
          result_path = VALUES(result_path),
          result_summary = VALUES(result_summary),
          record_json = VALUES(record_json),
          result_json = VALUES(result_json),
          client_json = VALUES(client_json),
          updated_at = VALUES(updated_at)
      `,
      [
        record.caseId,
        record.analysisType,
        record.status,
        record.source || null,
        record.userRequest || null,
        record.runtimeVersion || null,
        record.fileCount,
        record.storedPath,
        record.manifestPath || null,
        record.caseMarkdownPath || null,
        record.resultPath || null,
        record.resultSummary || null,
        JSON.stringify(record),
        resultJson ? JSON.stringify(resultJson) : null,
        record.client ? JSON.stringify(record.client) : null,
        new Date(record.createdAt),
        new Date(record.updatedAt),
      ],
    );

    for (const file of this.collectArtifacts(record, caseDir)) {
      await this.mysqlPool.query(
        `
          INSERT INTO inspector_case_files (
            case_id, relative_path, kind, size, uploaded_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            kind = VALUES(kind),
            size = VALUES(size),
            updated_at = VALUES(updated_at)
        `,
        [
          record.caseId,
          file.relativePath,
          file.kind,
          file.size,
          new Date(record.updatedAt),
          new Date(record.updatedAt),
        ],
      );
    }
  }

  private collectArtifacts(
    record: InspectorCaseRecord,
    caseDir: string,
  ): Array<{ relativePath: string; kind: InspectorFileKind; size: number }> {
    const artifactMap = new Map<string, { kind: InspectorFileKind; size: number }>();
    const register = (relativePath: string | undefined, kind: InspectorFileKind) => {
      if (!relativePath) {
        return;
      }
      const normalized = relativePath.replace(/\\/g, '/');
      const absolutePath = path.join(caseDir, normalized);
      if (!fs.existsSync(absolutePath)) {
        return;
      }
      artifactMap.set(normalized, {
        kind,
        size: fs.statSync(absolutePath).size,
      });
    };

    for (const file of record.files) {
      register(file.path, (file.kind as InspectorFileKind) || 'other');
    }
    register('case.json', 'other');
    register(record.manifestPath, 'manifest');
    register(record.caseMarkdownPath, 'case_markdown');
    register(record.resultPath, 'other');
    register('agent-review.md', 'other');

    return Array.from(artifactMap.entries()).map(([relativePath, meta]) => ({
      relativePath,
      kind: meta.kind,
      size: meta.size,
    }));
  }

  private tryReadJson(filePath: string): unknown | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
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

  private async loadCaseFiles(
    caseId: string,
    fallback: InspectorCaseRecord['files'],
  ): Promise<InspectorCaseRecord['files']> {
    if (!this.mysqlPool) {
      return fallback;
    }

    const [rows] = await this.mysqlPool.query<FileRow[]>(
      'SELECT relative_path, kind, size FROM inspector_case_files WHERE case_id = ? ORDER BY id ASC',
      [caseId],
    );
    if (rows.length === 0) {
      return fallback;
    }

    return rows.map(row => ({
      path: row.relative_path,
      kind: row.kind || undefined,
      size: Number(row.size || 0),
    }));
  }
}
