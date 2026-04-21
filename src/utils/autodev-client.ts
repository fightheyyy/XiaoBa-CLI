import * as fs from 'fs';
import * as path from 'path';
import { getAutoDevApiKey, getAutoDevServerUrl } from './autodev-config';

export interface AutoDevCaseSummary {
  case_id: string;
  title: string;
  status: string;
  category?: string | null;
  source?: string | null;
  source_session_id?: string | null;
  source_user_id?: string | null;
  priority?: string | null;
  summary?: string | null;
  current_owner_agent?: string | null;
  recommended_next_action?: string | null;
  labels?: string[];
  workdir_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AutoDevSessionLogSummary {
  log_id: string;
  session_type: string;
  session_id: string;
  log_date: string;
  filename: string;
  size_bytes?: number;
  size_label?: string;
  uploaded_at?: string | null;
  download_url?: string;
}

export interface AutoDevLogCardRecord {
  card_id: string;
  log_id: string;
  agent: string;
  card_type: string;
  title: string;
  summary?: string | null;
  severity?: string | null;
  status?: string | null;
  payload?: Record<string, any>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AutoDevLogEventRecord {
  event_id: string;
  log_id: string;
  agent: string;
  kind: string;
  payload: Record<string, any>;
  created_at?: string | null;
}

export interface AutoDevLogDetail {
  log: AutoDevSessionLogSummary;
  preview_text?: string | null;
  preview_truncated?: boolean;
  analysis?: Record<string, unknown>;
  cards?: AutoDevLogCardRecord[];
  events?: AutoDevLogEventRecord[];
  related_logs?: AutoDevSessionLogSummary[];
}

export interface AutoDevArtifactRecord {
  artifact_id: string;
  case_id: string;
  type: string;
  stage: string;
  title: string;
  format: string;
  storage_mode?: string;
  storage_path?: string | null;
  local_path?: string | null;
  bucket_name?: string | null;
  object_key?: string | null;
  original_filename?: string | null;
  size_bytes?: number | null;
  size_label?: string | null;
  content_type?: string | null;
  produced_by_agent?: string | null;
  version?: number | null;
  metadata?: Record<string, any>;
  created_at?: string | null;
  is_previewable?: boolean;
  download_url?: string;
}

export interface AutoDevEventRecord {
  event_id: string;
  case_id: string;
  kind: string;
  actor_type: string;
  actor_id: string;
  payload: Record<string, any>;
  created_at?: string | null;
}

export interface AutoDevCaseDetail {
  case: AutoDevCaseSummary;
  artifacts: AutoDevArtifactRecord[];
  events: AutoDevEventRecord[];
  chain?: unknown[];
  metrics?: Record<string, unknown>;
}

export interface AutoDevCreateCaseRequest {
  title: string;
  source?: string;
  source_session_id?: string;
  source_user_id?: string;
  summary?: string;
  priority?: string;
  labels?: string[];
  category?: string;
  recommended_next_action?: string;
}

export interface AutoDevCreateCaseResponse {
  case_id: string;
  status: string;
  created_at?: string;
}

export interface AutoDevUpdateStateRequest {
  from: string;
  to: string;
  actor_id: string;
  reason?: string;
  category?: string;
  recommended_next_action?: string;
}

export interface AutoDevEventRequest {
  kind: string;
  actor_type?: string;
  actor_id: string;
  payload?: Record<string, any>;
}

export interface AutoDevUploadArtifactInput {
  caseId: string;
  filePath: string;
  type: string;
  stage: string;
  title: string;
  producedByAgent: string;
  format?: string;
  metadata?: Record<string, any>;
  contentType?: string;
  fileName?: string;
}

export interface AutoDevListCasesFilters {
  limit?: number;
  status?: string;
  owner?: string;
  category?: string;
  q?: string;
}

export interface AutoDevListLogsFilters {
  sessionType?: string;
  sessionId?: string;
  logDate?: string;
  limit?: number;
}

export class AutoDevClient {
  constructor(
    private readonly baseUrl: string = getAutoDevServerUrl(),
    private readonly apiKey: string = getAutoDevApiKey(),
  ) {}

  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async ingestLog(input: {
    filePath: string;
    sessionType: string;
    sessionId: string;
    logDate: string;
  }): Promise<{ log_id: string; session_type: string; session_id: string; log_date: string; size_bytes: number }> {
    const form = new FormData();
    form.append('session_type', input.sessionType);
    form.append('session_id', input.sessionId);
    form.append('log_date', input.logDate);
    const fileBuffer = fs.readFileSync(input.filePath);
    const fileName = path.basename(input.filePath);
    form.append('file', new Blob([fileBuffer], { type: 'application/x-ndjson' }), fileName);
    return this.requestFormData<{ log_id: string; session_type: string; session_id: string; log_date: string; size_bytes: number }>(
      'POST', '/api/logs/ingest', form,
    );
  }

  async listLogs(filters: AutoDevListLogsFilters = {}): Promise<AutoDevSessionLogSummary[]> {
    const params = new URLSearchParams();
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.sessionType) params.set('session_type', filters.sessionType);
    if (filters.sessionId) params.set('session_id', filters.sessionId);
    if (filters.logDate) params.set('log_date', filters.logDate);

    const query = params.toString();
    const response = await this.requestJson<{ items: AutoDevSessionLogSummary[] }>(
      'GET',
      `/api/logs${query ? `?${query}` : ''}`,
    );
    return Array.isArray(response.items) ? response.items : [];
  }

  async listPendingLogs(agent: string = 'inspector', limit: number = 20): Promise<AutoDevSessionLogSummary[]> {
    const params = new URLSearchParams();
    params.set('agent', agent);
    params.set('limit', String(limit));
    const response = await this.requestJson<{ items: AutoDevSessionLogSummary[] }>(
      'GET',
      `/api/logs/pending?${params.toString()}`,
    );
    return Array.isArray(response.items) ? response.items : [];
  }

  async getLogDetail(logId: string): Promise<AutoDevLogDetail> {
    return this.requestJson<AutoDevLogDetail>('GET', `/api/logs/${encodeURIComponent(logId)}`);
  }

  async appendLogEvent(
    logId: string,
    payload: { agent: string; kind: string; payload?: Record<string, any> },
  ): Promise<{ event_id: string }> {
    return this.requestJson<{ event_id: string }>(
      'POST',
      `/api/logs/${encodeURIComponent(logId)}/events`,
      payload,
    );
  }

  async appendLogCard(
    logId: string,
    payload: {
      agent: string;
      card_type: string;
      title: string;
      summary?: string;
      severity?: string;
      status?: string;
      payload?: Record<string, any>;
    },
  ): Promise<{ card_id: string }> {
    return this.requestJson<{ card_id: string }>(
      'POST',
      `/api/logs/${encodeURIComponent(logId)}/cards`,
      payload,
    );
  }

  async createCase(payload: AutoDevCreateCaseRequest): Promise<AutoDevCreateCaseResponse> {
    return this.requestJson<AutoDevCreateCaseResponse>('POST', '/api/cases', payload);
  }

  async listCases(filters: AutoDevListCasesFilters = {}): Promise<AutoDevCaseSummary[]> {
    const params = new URLSearchParams();
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.status) params.set('status', filters.status);
    if (filters.owner) params.set('owner', filters.owner);
    if (filters.category) params.set('category', filters.category);
    if (filters.q) params.set('q', filters.q);

    const query = params.toString();
    const response = await this.requestJson<{ items: AutoDevCaseSummary[] }>(
      'GET',
      `/api/cases${query ? `?${query}` : ''}`,
    );
    return Array.isArray(response.items) ? response.items : [];
  }

  async getCaseDetail(caseId: string): Promise<AutoDevCaseDetail> {
    return this.requestJson<AutoDevCaseDetail>('GET', `/api/cases/${encodeURIComponent(caseId)}`);
  }

  async appendEvent(caseId: string, payload: AutoDevEventRequest): Promise<{ event_id: string }> {
    return this.requestJson<{ event_id: string }>(
      'POST',
      `/api/cases/${encodeURIComponent(caseId)}/events`,
      payload,
    );
  }

  async updateState(caseId: string, payload: AutoDevUpdateStateRequest): Promise<{ case_id: string; status: string; updated_at?: string }> {
    return this.requestJson<{ case_id: string; status: string; updated_at?: string }>(
      'POST',
      `/api/cases/${encodeURIComponent(caseId)}/state`,
      payload,
    );
  }

  async uploadArtifact(input: AutoDevUploadArtifactInput): Promise<{ artifact_id: string; case_id: string }> {
    const form = new FormData();
    form.set('type', input.type);
    form.set('stage', input.stage);
    form.set('title', input.title);
    form.set('produced_by_agent', input.producedByAgent);
    form.set('format', input.format || inferArtifactFormat(input.filePath));
    form.set('metadata', JSON.stringify(input.metadata || {}));

    const fileBuffer = fs.readFileSync(input.filePath);
    const fileName = input.fileName || path.basename(input.filePath);
    form.set(
      'file',
      new Blob([fileBuffer], { type: input.contentType || inferContentType(fileName) }),
      fileName,
    );

    return this.requestFormData<{ artifact_id: string; case_id: string }>(
      'POST',
      `/api/cases/${encodeURIComponent(input.caseId)}/artifacts`,
      form,
    );
  }

  async downloadArtifact(artifactId: string): Promise<Buffer> {
    const response = await fetch(this.buildUrl(`/api/artifacts/${encodeURIComponent(artifactId)}/download`), {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AutoDev download failed (${response.status}): ${body}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async downloadLog(logId: string): Promise<Buffer> {
    const response = await fetch(this.buildUrl(`/api/logs/${encodeURIComponent(logId)}/download`), {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AutoDev log download failed (${response.status}): ${body}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async requestJson<T>(method: string, requestPath: string, body?: unknown): Promise<T> {
    const headers = this.buildHeaders();
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(this.buildUrl(requestPath), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`AutoDev request failed (${response.status}): ${responseText}`);
    }

    if (!responseText.trim()) {
      return {} as T;
    }
    return JSON.parse(responseText) as T;
  }

  private async requestFormData<T>(method: string, requestPath: string, form: FormData): Promise<T> {
    const response = await fetch(this.buildUrl(requestPath), {
      method,
      headers: this.buildHeaders(),
      body: form,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`AutoDev upload failed (${response.status}): ${responseText}`);
    }

    if (!responseText.trim()) {
      return {} as T;
    }
    return JSON.parse(responseText) as T;
  }

  private buildHeaders(): Record<string, string> {
    return this.apiKey
      ? { 'x-autodev-key': this.apiKey }
      : {};
  }

  private buildUrl(requestPath: string): string {
    if (!this.baseUrl) {
      throw new Error('AUTODEV_SERVER_URL is not set');
    }
    return new URL(requestPath, `${this.baseUrl}/`).toString();
  }
}

export function inferArtifactFormat(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'json';
    case '.jsonl':
      return 'jsonl';
    case '.log':
      return 'log';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.txt':
      return 'text';
    default:
      return ext.replace(/^\./, '') || 'binary';
  }
}

export function inferContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.jsonl':
      return 'application/x-ndjson';
    case '.md':
    case '.markdown':
      return 'text/markdown; charset=utf-8';
    case '.log':
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
