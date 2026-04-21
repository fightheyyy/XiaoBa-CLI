import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { AutoDevInspectorWorker } from '../src/roles/inspector-cat/utils/autodev-inspector-worker';
import { InspectorReviewExecutor } from '../src/roles/inspector-cat/utils/inspector-agent-review-executor';

describe('AutoDevInspectorWorker', () => {
  let testRoot: string;
  let server: http.Server | null = null;
  const originalAutoDevServerUrl = process.env.AUTODEV_SERVER_URL;
  const originalAutoDevApiKey = process.env.AUTODEV_API_KEY;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-autodev-inspector-worker-'));
  });

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server?.close(resolve));
      server = null;
    }

    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }

    restoreEnv('AUTODEV_SERVER_URL', originalAutoDevServerUrl);
    restoreEnv('AUTODEV_API_KEY', originalAutoDevApiKey);
  });

  test('会从 AutoDev 拉取待审日志，审查成功后回写 cards 和 events，并清理成功工作目录', async () => {
    const rawLog = '{"entry_type":"runtime","session_id":"user:ou_demo","message":"hello"}\n';
    const logId = 'log-20260420-001';
    const filename = 'feishu_user_ou_demo.jsonl';
    const appendedEvents: any[] = [];
    const appendedCards: any[] = [];

    server = createAutoDevServer({
      logId,
      filename,
      rawLog,
      onAppendEvent(payload) {
        appendedEvents.push(payload);
      },
      onAppendCard(payload) {
        appendedCards.push(payload);
      },
    });

    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    process.env.AUTODEV_SERVER_URL = `http://127.0.0.1:${address.port}`;
    process.env.AUTODEV_API_KEY = 'demo-key';

    const reviewExecutor: InspectorReviewExecutor = {
      async reviewCase(record, store) {
        const caseDir = store.getCaseDir(record.caseId);
        assert.ok(fs.existsSync(path.join(caseDir, 'logs', filename)));

        const reportPath = path.join(caseDir, 'agent-review.md');
        fs.writeFileSync(reportPath, '# AutoDev Inspector Report\n', 'utf-8');

        return {
          generatedAt: new Date().toISOString(),
          caseId: record.caseId,
          mode: 'agent_review',
          summary: {
            overview: 'Inspector completed review from AutoDev log data.',
            deliveryCount: 2,
            reportGenerated: true,
          },
          reportFilePath: 'agent-review.md',
          finalText: '审查完成',
          deliveries: [
            { type: 'text', text: '摘要' },
            { type: 'file', filePath: reportPath, fileName: 'agent-review.md' },
          ],
        };
      },
    };

    const worker = new AutoDevInspectorWorker({
      workingDirectory: testRoot,
      reviewExecutor,
    });

    const result = await worker.runOnce();

    assert.deepStrictEqual(result, { processed: 1, skipped: false });
    assert.strictEqual(appendedEvents.length, 2);
    assert.strictEqual(appendedEvents[0].kind, 'inspector_review_started');
    assert.strictEqual(appendedEvents[1].kind, 'inspector_review_completed');
    assert.match(appendedEvents[1].payload.overview, /AutoDev log data/);

    assert.strictEqual(appendedCards.length, 1);
    assert.strictEqual(appendedCards[0].card_type, 'issue');
    assert.match(appendedCards[0].payload.report_markdown, /AutoDev Inspector Report/);

    const workspaceDir = path.join(testRoot, 'data', 'autodev-inspector-logs', logId);
    assert.ok(!fs.existsSync(workspaceDir));
  });

  test('审查失败时会回写 failure card/event，并保留工作目录', async () => {
    const rawLog = '{"entry_type":"runtime","session_id":"user:ou_demo","message":"broken"}\n';
    const logId = 'log-20260420-002';
    const filename = 'feishu_user_ou_demo.jsonl';
    const appendedEvents: any[] = [];
    const appendedCards: any[] = [];

    server = createAutoDevServer({
      logId,
      filename,
      rawLog,
      onAppendEvent(payload) {
        appendedEvents.push(payload);
      },
      onAppendCard(payload) {
        appendedCards.push(payload);
      },
    });

    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    process.env.AUTODEV_SERVER_URL = `http://127.0.0.1:${address.port}`;
    process.env.AUTODEV_API_KEY = 'demo-key';

    const reviewExecutor: InspectorReviewExecutor = {
      async reviewCase() {
        throw new Error('review exploded');
      },
    };

    const worker = new AutoDevInspectorWorker({
      workingDirectory: testRoot,
      reviewExecutor,
    });

    const result = await worker.runOnce();

    assert.deepStrictEqual(result, { processed: 1, skipped: false });
    assert.strictEqual(appendedEvents.length, 2);
    assert.strictEqual(appendedEvents[0].kind, 'inspector_review_started');
    assert.strictEqual(appendedEvents[1].kind, 'inspector_review_failed');

    assert.strictEqual(appendedCards.length, 1);
    assert.strictEqual(appendedCards[0].card_type, 'failure');
    assert.match(appendedCards[0].summary, /review exploded/);

    const workspaceDir = path.join(testRoot, 'data', 'autodev-inspector-logs', logId);
    assert.ok(fs.existsSync(workspaceDir));
    assert.ok(fs.existsSync(path.join(workspaceDir, 'logs', filename)));
    assert.ok(fs.existsSync(path.join(workspaceDir, 'inspector-failure.json')));
  });

  test('审查成功且生成 handoff 时，会创建 AutoDev case 并移交 Engineer', async () => {
    const rawLog = '{"entry_type":"runtime","session_id":"user:ou_demo","message":"timeout"}\n';
    const logId = 'log-20260420-003';
    const filename = 'feishu_user_timeout.jsonl';
    const appendedEvents: any[] = [];
    const appendedCards: any[] = [];
    const createdCases: any[] = [];
    const uploadedArtifacts: Array<{ path: string; bodyText: string }> = [];
    const stateTransitions: any[] = [];
    const caseEvents: any[] = [];

    server = createAutoDevServer({
      logId,
      filename,
      rawLog,
      onAppendEvent(payload) {
        appendedEvents.push(payload);
      },
      onAppendCard(payload) {
        appendedCards.push(payload);
      },
      onCreateCase(payload) {
        createdCases.push(payload);
      },
      onUploadArtifact(targetPath, bodyText) {
        uploadedArtifacts.push({ path: targetPath, bodyText });
      },
      onCaseState(payload) {
        stateTransitions.push(payload);
      },
      onCaseEvent(payload) {
        caseEvents.push(payload);
      },
    });

    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    process.env.AUTODEV_SERVER_URL = `http://127.0.0.1:${address.port}`;
    process.env.AUTODEV_API_KEY = 'demo-key';

    const reviewExecutor: InspectorReviewExecutor = {
      async reviewCase(record, store) {
        const caseDir = store.getCaseDir(record.caseId);
        fs.writeFileSync(path.join(caseDir, 'agent-review.md'), '# Runtime timeout root cause\n', 'utf-8');
        fs.writeFileSync(path.join(caseDir, 'autodev-handoff.json'), JSON.stringify({
          version: 1,
          shouldCreateCase: true,
          title: 'Fix repeated runtime timeout',
          category: 'runtime_bug',
          priority: 'high',
          recommendedNextAction: 'runtime_fix',
          summary: 'Timeout keeps reproducing in the runtime tool path.',
          nextState: 'fixing',
          evidenceSummary: {
            rootCauseHypothesis: 'timeout path has no fallback',
            confidence: 'high',
            signals: ['timeout', 'repeated failure'],
          },
          labels: ['runtime', 'timeout'],
        }, null, 2), 'utf-8');

        return {
          generatedAt: new Date().toISOString(),
          caseId: record.caseId,
          mode: 'agent_review',
          summary: {
            overview: 'Inspector found a stable runtime bug.',
            deliveryCount: 1,
            reportGenerated: true,
          },
          reportFilePath: 'agent-review.md',
          finalText: '审查完成',
          deliveries: [
            { type: 'text', text: '摘要' },
          ],
        };
      },
    };

    const worker = new AutoDevInspectorWorker({
      workingDirectory: testRoot,
      reviewExecutor,
    });

    const result = await worker.runOnce();

    assert.deepStrictEqual(result, { processed: 1, skipped: false });
    assert.strictEqual(createdCases.length, 1);
    assert.strictEqual(createdCases[0].category, 'runtime_bug');
    assert.strictEqual(createdCases[0].recommended_next_action, 'runtime_fix');
    assert.strictEqual(uploadedArtifacts.length, 3);
    assert.ok(uploadedArtifacts.some(item => item.bodyText.includes('Inspector assessment')));
    assert.ok(uploadedArtifacts.some(item => item.bodyText.includes('"category": "runtime_bug"')));
    assert.strictEqual(stateTransitions.length, 2);
    assert.deepStrictEqual(stateTransitions.map(item => `${item.from}->${item.to}`), ['new->inspecting', 'inspecting->fixing']);
    assert.strictEqual(caseEvents.length, 1);
    assert.strictEqual(caseEvents[0].kind, 'inspector_case_linked_to_log');
    assert.strictEqual(appendedCards.length, 1);
    assert.strictEqual(appendedEvents.at(-1).kind, 'inspector_review_completed');
    assert.strictEqual(appendedEvents.at(-1).payload.autodev_case_id, 'case-001');
  });
});

function createAutoDevServer(options: {
  logId: string;
  filename: string;
  rawLog: string;
  onAppendEvent: (payload: any) => void;
  onAppendCard: (payload: any) => void;
  onCreateCase?: (payload: any) => void;
  onUploadArtifact?: (targetPath: string, bodyText: string) => void;
  onCaseState?: (payload: any) => void;
  onCaseEvent?: (payload: any) => void;
}): http.Server {
  return http.createServer((req, res) => {
    const requestUrl = new URL(String(req.url || '/'), 'http://127.0.0.1');
    const chunks: Buffer[] = [];

    req.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf-8');

      if (requestUrl.pathname === '/api/logs/pending') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          items: [
            {
              log_id: options.logId,
              session_type: 'feishu',
              session_id: 'user:ou_demo',
              log_date: '2026-04-20',
              filename: options.filename,
              uploaded_at: '2026-04-20T08:00:00',
            },
          ],
        }));
        return;
      }

      if (requestUrl.pathname === `/api/logs/${options.logId}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          log: {
            log_id: options.logId,
            session_type: 'feishu',
            session_id: 'user:ou_demo',
            log_date: '2026-04-20',
            filename: options.filename,
            uploaded_at: '2026-04-20T08:00:00',
          },
          cards: [],
          events: [],
          related_logs: [],
        }));
        return;
      }

      if (requestUrl.pathname === `/api/logs/${options.logId}/download`) {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(options.rawLog);
        return;
      }

      if (requestUrl.pathname === `/api/logs/${options.logId}/events`) {
        const payload = JSON.parse(bodyText || '{}');
        options.onAppendEvent(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ event_id: `evt-${Date.now()}` }));
        return;
      }

      if (requestUrl.pathname === `/api/logs/${options.logId}/cards`) {
        const payload = JSON.parse(bodyText || '{}');
        options.onAppendCard(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ card_id: `card-${Date.now()}` }));
        return;
      }

      if (requestUrl.pathname === '/api/cases' && req.method === 'POST') {
        const payload = JSON.parse(bodyText || '{}');
        options.onCreateCase?.(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ case_id: 'case-001', status: 'new', created_at: '2026-04-20T08:00:00' }));
        return;
      }

      if (requestUrl.pathname === '/api/cases/case-001/artifacts' && req.method === 'POST') {
        options.onUploadArtifact?.(requestUrl.pathname, bodyText);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ artifact_id: `art-${Date.now()}`, case_id: 'case-001' }));
        return;
      }

      if (requestUrl.pathname === '/api/cases/case-001/state' && req.method === 'POST') {
        const payload = JSON.parse(bodyText || '{}');
        options.onCaseState?.(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ case_id: 'case-001', status: payload.to, updated_at: '2026-04-20T08:05:00' }));
        return;
      }

      if (requestUrl.pathname === '/api/cases/case-001/events' && req.method === 'POST') {
        const payload = JSON.parse(bodyText || '{}');
        options.onCaseEvent?.(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ event_id: `case-evt-${Date.now()}` }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', path: requestUrl.pathname }));
    });
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
