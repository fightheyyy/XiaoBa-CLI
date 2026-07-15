import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface CrontabAdapter {
  read(): string;
  write(content: string): void;
}

export interface EvolutionScheduleOptions {
  workingDirectory: string;
  hour?: number;
  minute?: number;
  entryFile?: string;
  nodeExecutable?: string;
  crontab?: CrontabAdapter;
}

export interface EvolutionScheduleStatus {
  installed: boolean;
  schedule: string;
  command: string;
  marker: string;
}

export class EvolutionSleepSchedule {
  private readonly workingDirectory: string;
  private readonly hour: number;
  private readonly minute: number;
  private readonly entryFile: string;
  private readonly nodeExecutable: string;
  private readonly crontab: CrontabAdapter;

  constructor(options: EvolutionScheduleOptions) {
    if (process.platform !== 'darwin' && !options.crontab) {
      throw new Error('EVOLUTION_SCHEDULE_UNSUPPORTED：当前自动 schedule 只支持具备 Arena Seatbelt 隔离的 macOS。');
    }
    this.workingDirectory = path.resolve(options.workingDirectory);
    this.hour = validateTimePart(options.hour ?? 3, 0, 23, 'hour');
    this.minute = validateTimePart(options.minute ?? 17, 0, 59, 'minute');
    this.entryFile = path.resolve(options.entryFile || process.argv[1]);
    this.nodeExecutable = path.resolve(options.nodeExecutable || process.execPath);
    this.crontab = options.crontab || new SystemCrontabAdapter();
  }

  install(): EvolutionScheduleStatus & { changed: boolean } {
    const current = this.crontab.read();
    const withoutExisting = removeBlock(current, this.blockStart(), this.blockEnd());
    const next = appendBlock(withoutExisting, this.block());
    const changed = normalizeCrontab(current) !== normalizeCrontab(next);
    if (changed) {
      fs.mkdirSync(path.join(this.workingDirectory, 'logs'), { recursive: true });
      this.crontab.write(next);
    }
    return { ...this.statusFromContent(next), changed };
  }

  remove(): EvolutionScheduleStatus & { changed: boolean } {
    const current = this.crontab.read();
    const next = removeBlock(current, this.blockStart(), this.blockEnd());
    const changed = normalizeCrontab(current) !== normalizeCrontab(next);
    if (changed) this.crontab.write(next);
    return { ...this.statusFromContent(next), changed };
  }

  status(): EvolutionScheduleStatus {
    return this.statusFromContent(this.crontab.read());
  }

  private statusFromContent(content: string): EvolutionScheduleStatus {
    const installedLine = ownedCronLine(content, this.blockStart(), this.blockEnd());
    const parsed = installedLine?.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
    return {
      installed: Boolean(parsed),
      schedule: parsed?.[1] || `${this.minute} ${this.hour} * * *`,
      command: parsed?.[2] || this.command(),
      marker: this.marker(),
    };
  }

  private block(): string {
    return [this.blockStart(), `${this.minute} ${this.hour} * * * ${this.command()}`, this.blockEnd()].join('\n');
  }

  private command(): string {
    const logPath = path.join(this.workingDirectory, 'logs', 'evolution-sleep.log');
    const invocation = this.entryFile.endsWith('.ts')
      ? `${shellQuote(path.join(this.workingDirectory, 'node_modules', '.bin', 'tsx'))} ${shellQuote(this.entryFile)}`
      : `${shellQuote(this.nodeExecutable)} ${shellQuote(this.entryFile)}`;
    return `cd ${shellQuote(this.workingDirectory)} && ${invocation} evolution sleep >> ${shellQuote(logPath)} 2>&1`;
  }

  private marker(): string {
    return crypto.createHash('sha256').update(this.workingDirectory).digest('hex').slice(0, 12);
  }

  private blockStart(): string {
    return `# BEGIN xiaoba-evolution-sleep:${this.marker()}`;
  }

  private blockEnd(): string {
    return `# END xiaoba-evolution-sleep:${this.marker()}`;
  }
}

function ownedCronLine(content: string, startMarker: string, endMarker: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === startMarker);
  const end = lines.findIndex((line, index) => index > start && line.trim() === endMarker);
  if (start < 0 || end <= start) return undefined;
  return lines.slice(start + 1, end).map(line => line.trim()).find(line => line && !line.startsWith('#'));
}

class SystemCrontabAdapter implements CrontabAdapter {
  read(): string {
    const result = spawnSync('crontab', ['-l'], { encoding: 'utf-8' });
    if (result.status === 0) return result.stdout || '';
    const stderr = String(result.stderr || '');
    if (result.status === 1 && /no crontab/i.test(stderr)) return '';
    throw new Error(`读取 crontab 失败：${stderr.trim() || `exit ${result.status}`}`);
  }

  write(content: string): void {
    const result = spawnSync('crontab', ['-'], {
      input: normalizeCrontab(content),
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      throw new Error(`写入 crontab 失败：${String(result.stderr || '').trim() || `exit ${result.status}`}`);
    }
  }
}

function validateTimePart(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 的整数。`);
  }
  return value;
}

function removeBlock(content: string, start: string, end: string): string {
  const lines = content.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === start) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === end) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  return normalizeCrontab(kept.join('\n')).trimEnd();
}

function appendBlock(content: string, block: string): string {
  const prefix = content.trim();
  return `${prefix ? `${prefix}\n` : ''}${block}\n`;
}

function normalizeCrontab(content: string): string {
  return `${content.replace(/\r\n/g, '\n').trimEnd()}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
