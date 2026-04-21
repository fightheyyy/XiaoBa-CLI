import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { AutoDevEngineerWorker } from '../src/roles/engineer-cat/utils/autodev-engineer-worker';
import { EngineerExecutionExecutor } from '../src/roles/engineer-cat/utils/engineer-agent-executor';

describe('AutoDevEngineerWorker', () => {
  let testRoot: string;
  let server: http.Server | null = null;
  const originalAutoDevServerUrl = process.env.AUTODEV_SERVER_URL;
  const originalAutoDevApiKey = process.env.AUTODEV_API_KEY;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-autodev-engineer-worker-'));
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

  test('会拉取 engineer case，上传实现产物并推进到 reviewing', async () => {
    const caseEvents: any[] = [];
    const stateTransitions: any[] = [];
    const artifactUploads: Array<{ path: string; bodyText: string }> = [];

    server = createAutoDevEngineerServer({
      onCaseEvent(payload) {
        caseEvents.push(payload);
      },
      onStateTransition(payload) {
        stateTransitions.push(payload);
      },
      onArtifactUpload(targetPath, bodyText) {
        artifactUploads.push({ path: targetPath, bodyText });
      },
    });

    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    process.env.AUTODEV_SERVER_URL = `http://127.0.0.1:${address.port}`;
    process.env.AUTODEV_API_KEY = 'demo-key';

    const executionExecutor: EngineerExecutionExecutor = {
      async executeCase(detail, store) {
        const caseDir = store.getCaseDir(detail.case.case_id);
        fs.writeFileSync(path.join(caseDir, 'implementation.md'), '# Implementation note\n', 'utf-8');
        fs.writeFileSync(path.join(caseDir, 'engineer-output.json'), JSON.stringify({
          version: 1,
          summary: 'Patched runtime retry logic.',
          overview: 'Patched runtime retry logic and prepared review handoff.',
          resultType: 'runtime_fix',
          riskLevel: 'medium',
          nextState: 'reviewing',
          recommendedNextAction: 'review_engineer_output',
          changedFiles: ['src/tools/retry.ts'],
          artifacts: [],
        }, null, 2), 'utf-8');
        fs.writeFileSync(path.join(caseDir, 'implementation.patch'), 'diff --git a/src/tools/retry.ts b/src/tools/retry.ts\n', 'utf-8');

        return {
          generatedAt: new Date().toISOString(),
          caseId: detail.case.case_id,
          mode: 'agent_execute',
          summary: {
            overview: 'Engineer finished the runtime fix.',
            artifactCount: 3,
            nextState: 'reviewing',
            implementationGenerated: true,
          },
          implementationNotePath: 'implementation.md',
          outputFilePath: 'engineer-output.json',
          patchFilePath: 'implementation.patch',
          finalText: 'done',
        };
      },
    };

    const worker = new AutoDevEngineerWorker({
      workingDirectory: testRoot,
      executionExecutor,
    });

    const result = await worker.runOnce();

    assert.deepStrictEqual(result, { processed: 1, skipped: false });
    assert.strictEqual(caseEvents.length, 2);
    assert.strictEqual(caseEvents[0].kind, 'engineer_execution_started');
    assert.strictEqual(caseEvents[1].kind, 'engineer_execution_completed');
    assert.strictEqual(stateTransitions.length, 1);
    assert.deepStrictEqual(stateTransitions[0], {
      from: 'fixing',
      to: 'reviewing',
      actor_id: 'engineer',
      reason: 'Patched runtime retry logic.',
      category: 'runtime_bug',
      recommended_next_action: 'review_engineer_output',
    });
    assert.strictEqual(artifactUploads.length, 3);
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Engineer implementation note')));
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Engineer execution output')));
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Engineer implementation patch')));

    const workspaceDir = path.join(testRoot, 'data', 'autodev-engineer-cases', 'case-001');
    assert.ok(!fs.existsSync(workspaceDir));
  });
});

function createAutoDevEngineerServer(options: {
  onCaseEvent: (payload: any) => void;
  onStateTransition: (payload: any) => void;
  onArtifactUpload: (targetPath: string, bodyText: string) => void;
}): http.Server {
  return http.createServer((req, res) => {
    const requestUrl = new URL(String(req.url || '/'), 'http://127.0.0.1');
    const chunks: Buffer[] = [];

    req.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf-8');

      if (requestUrl.pathname === '/api/cases' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          items: [
            {
              case_id: 'case-001',
              title: 'Fix repeated runtime timeout',
              status: 'fixing',
              category: 'runtime_bug',
              current_owner_agent: 'engineer',
              recommended_next_action: 'runtime_fix',
              updated_at: '2026-04-20T08:00:00',
            },
          ],
        }));
        return;
      }

      if (requestUrl.pathname === '/api/cases/case-001' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          case: {
            case_id: 'case-001',
            title: 'Fix repeated runtime timeout',
            status: 'fixing',
            category: 'runtime_bug',
            current_owner_agent: 'engineer',
            recommended_next_action: 'runtime_fix',
            summary: 'Timeout is reproducible.',
          },
          artifacts: [
            {
              artifact_id: 'art-raw',
              case_id: 'case-001',
              type: 'raw_jsonl',
              stage: 'input',
              title: 'raw session log',
              format: 'jsonl',
              original_filename: 'session.jsonl',
            },
            {
              artifact_id: 'art-assessment',
              case_id: 'case-001',
              type: 'assessment',
              stage: 'analysis',
              title: 'Inspector assessment',
              format: 'markdown',
              original_filename: 'assessment.md',
            },
          ],
          events: [],
          chain: [],
          metrics: {},
        }));
        return;
      }

      if (requestUrl.pathname === '/api/artifacts/art-raw/download' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end('{"message":"timeout"}\n');
        return;
      }

      if (requestUrl.pathname === '/api/artifacts/art-assessment/download' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/markdown' });
        res.end('# Inspector assessment\n');
        return;
      }

      if (requestUrl.pathname === '/api/cases/case-001/events' && req.method === 'POST') {
        const payload = JSON.parse(bodyText || '{}');
        options.onCaseEvent(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ event_id: `evt-${Date.now()}` }));
        return;
      }

      if (requestUrl.pathname === '/api/cases/case-001/state' && req.method === 'POST') {
        const payload = JSON.parse(bodyText || '{}');
        options.onStateTransition(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ case_id: 'case-001', status: payload.to, updated_at: '2026-04-20T08:10:00' }));
        return;
      }

      if (requestUrl.pathname === '/api/cases/case-001/artifacts' && req.method === 'POST') {
        options.onArtifactUpload(requestUrl.pathname, bodyText);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ artifact_id: `art-${Date.now()}`, case_id: 'case-001' }));
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
