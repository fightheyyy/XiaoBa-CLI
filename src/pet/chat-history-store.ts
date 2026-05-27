import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

export interface PetVisibleHistoryEvent {
  type: string;
  id?: number;
  petId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function keyToFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.jsonl';
}

function parseJsonLine(line: string): PetVisibleHistoryEvent | null {
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as PetVisibleHistoryEvent;
  } catch {
    return null;
  }
}

export class PetChatHistoryStore {
  constructor(private readonly sessionDir = path.resolve(process.cwd(), 'data', 'chat', 'sessions')) {}

  append(petId: string, event: PetVisibleHistoryEvent): void {
    try {
      fs.mkdirSync(this.sessionDir, { recursive: true });
      fs.appendFileSync(this.filePath(petId), JSON.stringify(event) + '\n', 'utf-8');
    } catch (err: any) {
      Logger.warning(`[pet:${petId}] Chat history append failed: ${err.message}`);
    }
  }

  read(petId: string, limit = DEFAULT_LIMIT): PetVisibleHistoryEvent[] {
    try {
      const fp = this.filePath(petId);
      if (!fs.existsSync(fp)) return [];
      const content = fs.readFileSync(fp, 'utf-8').trim();
      if (!content) return [];

      const parsed = content
        .split('\n')
        .map(parseJsonLine)
        .filter((event): event is PetVisibleHistoryEvent => Boolean(event));

      return parsed.slice(-this.normalizeLimit(limit));
    } catch (err: any) {
      Logger.warning(`[pet:${petId}] Chat history read failed: ${err.message}`);
      return [];
    }
  }

  delete(petId: string): void {
    try {
      const fp = this.filePath(petId);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err: any) {
      Logger.warning(`[pet:${petId}] Chat history delete failed: ${err.message}`);
    }
  }

  getMaxEventId(): number {
    try {
      if (!fs.existsSync(this.sessionDir)) return 0;

      let max = 0;
      for (const entry of fs.readdirSync(this.sessionDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const content = fs.readFileSync(path.join(this.sessionDir, entry.name), 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          const event = parseJsonLine(line);
          if (typeof event?.id === 'number' && Number.isSafeInteger(event.id)) {
            max = Math.max(max, event.id);
          }
        }
      }
      return max;
    } catch (err: any) {
      Logger.warning(`[pet] Chat history max id scan failed: ${err.message}`);
      return 0;
    }
  }

  filePath(petId: string): string {
    return path.join(this.sessionDir, keyToFilename(`pet:${petId}`));
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
    return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
  }
}
