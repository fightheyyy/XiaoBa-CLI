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
    Logger.setSilentMode(false);
    await waitForFlush();
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('runtime log lines persist only through session JSONL context', async () => {
    Logger.setSilentMode(true);
    const sessionLogger = new SessionTurnLogger('feishu', 'user:ou_demo');
    const sessionLogPath = sessionLogger.getLogFilePath();
    if (fs.existsSync(sessionLogPath)) {
      fs.unlinkSync(sessionLogPath);
    }

    Logger.info('outside context');
    await Logger.withSessionContext('user:ou_demo', sessionLogger, async () => {
      Logger.info('inside context');
      await Promise.resolve();
      Logger.info('still inside context');
    });

    assert.ok(sessionLogPath);

    await waitForFlush();

    const plainLogFiles = listFiles(path.join(testRoot, 'logs'))
      .filter(filePath => filePath.endsWith('.log'));
    assert.deepEqual(plainLogFiles, []);

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

  test('session JSONL turn logs include benchmark-friendly structured fields', () => {
    const sessionLogger = new SessionTurnLogger('feishu', 'user:ou_demo');
    const sessionLogPath = sessionLogger.getLogFilePath();
    if (fs.existsSync(sessionLogPath)) {
      fs.unlinkSync(sessionLogPath);
    }

    sessionLogger.logTurn(
      '画图并发我',
      '已生成图片',
      [
        {
          id: 'call-1',
          name: 'execute_shell',
          arguments: { command: 'Rscript plot.R' },
          result: 'saved /share/home/example-user/project/output/CD3D_feature.png',
          duration_ms: 12,
        },
        {
          id: 'call-2',
          name: 'execute_shell',
          arguments: { command: 'Rscript retry.R' },
          result: 'timeout while running Rscript',
          duration_ms: 30000,
        },
      ],
      { prompt: 100, completion: 20 },
    );

    const [entry] = fs.readFileSync(sessionLogPath, 'utf-8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));

    assert.equal(entry.schema_version, 2);
    assert.match(entry.turn_id, /^user_ou_demo\.turn\.1$/);
    assert.equal(entry.tokens.prompt, 100);
    assert.equal(entry.tokens.completion, 20);
    assert.equal(entry.assistant.tool_calls[0].tool_call_id, 'call-1');
    assert.equal(entry.assistant.tool_calls[0].status, 'success');
    assert.deepEqual(entry.assistant.tool_calls[0].artifact_manifest, [
      {
        path: '/share/home/[USER]/project/output/CD3D_feature.png',
        type: 'png',
        action: 'created',
      },
    ]);
    assert.equal(entry.assistant.tool_calls[1].status, 'failure');
    assert.equal(entry.assistant.tool_calls[1].error_code, 'TOOL_TIMEOUT');
  });
});

function waitForFlush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 20));
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else {
        result.push(fullPath);
      }
    }
  };
  visit(root);
  return result;
}
