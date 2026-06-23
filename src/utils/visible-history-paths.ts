import * as path from 'path';

export type VisibleHistorySurface = 'pet' | 'dashboard';

export function visibleHistoryFileName(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_') + '.jsonl';
}

export function visibleHistoryDir(surface: VisibleHistorySurface): string {
  const segment = surface === 'dashboard' ? 'dashboard-room' : 'sessions';
  return path.resolve(process.cwd(), 'data', 'chat', segment);
}

export function visibleHistoryFilePath(surface: VisibleHistorySurface, sessionKey: string): string {
  return path.join(visibleHistoryDir(surface), visibleHistoryFileName(sessionKey));
}
