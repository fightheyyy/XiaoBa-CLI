import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../src/utils/logger';
import { SessionTurnLogger } from '../src/utils/session-turn-logger';

describe('Logger', () => {
  let testRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-logger-'));
    process.chdir(testRoot);
  });

  afterEach(async () => {
    Logger.closeLogFile();
    await waitForFlush();
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('runtime log lines include session_id from async context', async () => {
    Logger.openLogFile('test', undefined, true);
    const sessionLogger = new SessionTurnLogger('feishu', 'user:ou_demo');

    Logger.info('outside context');
    await Logger.withSessionContext('user:ou_demo', sessionLogger, async () => {
      Logger.info('inside context');
      await Promise.resolve();
      Logger.info('still inside context');
    });

    const globalLogPath = Logger.getLogFilePath();
    const sessionLogPath = sessionLogger.getLogFilePath();
    assert.ok(globalLogPath);
    assert.ok(sessionLogPath);

    Logger.closeLogFile();
    await waitForFlush();

    const globalContent = fs.readFileSync(globalLogPath, 'utf-8');
    assert.match(globalContent, /\[INFO\] outside context/);
    assert.doesNotMatch(globalContent, /inside context/);
    assert.doesNotMatch(globalContent, /still inside context/);

    const sessionEntries = fs.readFileSync(sessionLogPath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    assert.deepStrictEqual(
      sessionEntries.map(entry => ({
        entry_type: entry.entry_type,
        level: entry.level,
        message: entry.message,
        session_id: entry.session_id,
      })),
      [
        {
          entry_type: 'runtime',
          level: 'INFO',
          message: 'inside context',
          session_id: 'user:ou_demo',
        },
        {
          entry_type: 'runtime',
          level: 'INFO',
          message: 'still inside context',
          session_id: 'user:ou_demo',
        },
      ],
    );
  });
});

function waitForFlush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 20));
}
