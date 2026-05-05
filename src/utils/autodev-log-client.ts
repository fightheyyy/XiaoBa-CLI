import * as fs from 'fs';
import * as path from 'path';
import { getAutoDevApiKey, getAutoDevServerUrl } from './autodev-config';

export interface AutoDevLogIngestResponse {
  log_id: string;
  session_type: string;
  session_id: string;
  log_date: string;
  size_bytes: number;
}

export interface AutoDevLogIngestInput {
  filePath: string;
  sessionType: string;
  sessionId: string;
  logDate: string;
}

export class AutoDevLogClient {
  constructor(
    private readonly baseUrl: string = getAutoDevServerUrl(),
    private readonly apiKey: string = getAutoDevApiKey(),
  ) {}

  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  async ingestLog(input: AutoDevLogIngestInput): Promise<AutoDevLogIngestResponse> {
    const form = new FormData();
    form.append('session_type', input.sessionType);
    form.append('session_id', input.sessionId);
    form.append('log_date', input.logDate);
    const fileBuffer = fs.readFileSync(input.filePath);
    const fileName = path.basename(input.filePath);
    form.append('file', new Blob([fileBuffer], { type: 'application/x-ndjson' }), fileName);

    const response = await fetch(this.buildUrl('/api/logs/ingest'), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: form,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`AutoDev upload failed (${response.status}): ${responseText}`);
    }

    if (!responseText.trim()) {
      return {
        log_id: '',
        session_type: input.sessionType,
        session_id: input.sessionId,
        log_date: input.logDate,
        size_bytes: 0,
      };
    }
    return JSON.parse(responseText) as AutoDevLogIngestResponse;
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
