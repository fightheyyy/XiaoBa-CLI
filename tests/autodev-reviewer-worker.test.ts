import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { AutoDevReviewerWorker } from '../src/roles/reviewer-cat/utils/autodev-reviewer-worker';
import { ReviewerExecutionExecutor } from '../src/roles/reviewer-cat/utils/reviewer-agent-executor';
import { ReviewerWritebackExecutor } from '../src/roles/reviewer-cat/utils/reviewer-writeback-executor';

describe('AutoDevReviewerWorker', () => {
  let testRoot: string;
  let server: http.Server | null = null;
  const originalAutoDevServerUrl = process.env.AUTODEV_SERVER_URL;
  const originalAutoDevApiKey = process.env.AUTODEV_API_KEY;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-autodev-reviewer-worker-'));
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

  test('会拉取 reviewer case，上传 review/writeback/metrics 并推进到 closed', async () => {
    const caseEvents: any[] = [];
    const stateTransitions: any[] = [];
    const artifactUploads: Array<{ path: string; bodyText: string }> = [];

    server = createAutoDevReviewerServer({
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

    const executionExecutor: ReviewerExecutionExecutor = {
      async executeCase(detail, store) {
        const caseDir = store.getCaseDir(detail.case.case_id);
        fs.writeFileSync(path.join(caseDir, 'review.md'), '# Review passed\n', 'utf-8');
        fs.writeFileSync(path.join(caseDir, 'closure.md'), '# Closure note\n', 'utf-8');
        fs.writeFileSync(path.join(caseDir, 'reviewer-output.json'), JSON.stringify({
          version: 1,
          summary: 'Validation passed and the case can be closed.',
          overview: 'Reviewer validated the engineer output against the original case evidence.',
          decision: 'closed',
          decisionReason: 'The implementation covers the observed failure mode.',
          nextState: 'closed',
          regressionStatus: 'passed',
          riskLevel: 'low',
          artifacts: [],
        }, null, 2), 'utf-8');

        return {
          generatedAt: new Date().toISOString(),
          caseId: detail.case.case_id,
          mode: 'agent_review',
          summary: {
            overview: 'Reviewer closed the case.',
            artifactCount: 3,
            decision: 'closed',
            nextState: 'closed',
          },
          reviewFilePath: 'review.md',
          outputFilePath: 'reviewer-output.json',
          closureFilePath: 'closure.md',
          finalText: 'done',
        };
      },
    };

    const writebackExecutor: ReviewerWritebackExecutor = {
      async execute(input) {
        const resultPath = path.join(input.workspaceDir, 'writeback-executed.txt');
        fs.writeFileSync(resultPath, 'done\n', 'utf-8');
        return {
          version: 1,
          caseId: input.detail.case.case_id,
          generatedAt: new Date().toISOString(),
          enabled: true,
          status: 'completed',
          summary: 'Writeback applied successfully.',
          reason: 'Validated patch was written back.',
          actionResults: [{
            target: 'runtime',
            action: 'apply_patch',
            status: 'completed',
            summary: 'Apply runtime patch',
            detail: 'Patch applied.',
            appliedPaths: ['src/tools/retry.ts'],
            sourceArtifacts: ['implementation.patch'],
          }],
        };
      },
    };

    const worker = new AutoDevReviewerWorker({
      workingDirectory: testRoot,
      executionExecutor,
      writebackExecutor,
    });

    const result = await worker.runOnce();

    assert.deepStrictEqual(result, { processed: 1, skipped: false });
    assert.strictEqual(caseEvents.length, 3);
    assert.strictEqual(caseEvents[0].kind, 'reviewer_validation_started');
    assert.strictEqual(caseEvents[1].kind, 'reviewer_writeback_completed');
    assert.strictEqual(caseEvents[2].kind, 'reviewer_validation_completed');
    assert.strictEqual(stateTransitions.length, 1);
    assert.deepStrictEqual(stateTransitions[0], {
      from: 'reviewing',
      to: 'closed',
      actor_id: 'reviewer',
      reason: 'The implementation covers the observed failure mode.',
      category: 'runtime_bug',
      recommended_next_action: 'writeback_completed',
    });
    assert.strictEqual(artifactUploads.length, 6);
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Reviewer validation report')));
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Reviewer structured decision')));
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Writeback strategy')));
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Writeback execution result')));
    assert.ok(artifactUploads.some(item => item.bodyText.includes('Case loop metrics')));

    const workspaceDir = path.join(testRoot, 'data', 'autodev-reviewer-cases', 'case-001');
    assert.ok(!fs.existsSync(workspaceDir));
  });
});

function createAutoDevReviewerServer(options: {
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
              status: 'reviewing',
              category: 'runtime_bug',
              current_owner_agent: 'reviewer',
              recommended_next_action: 'review_engineer_output',
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
            status: 'reviewing',
            category: 'runtime_bug',
            current_owner_agent: 'reviewer',
            recommended_next_action: 'review_engineer_output',
            summary: 'Timeout is reproducible.',
            created_at: '2026-04-20T08:00:00',
          },
          artifacts: [
            {
              artifact_id: 'art-assessment',
              case_id: 'case-001',
              type: 'assessment',
              stage: 'analysis',
              title: 'Inspector assessment',
              format: 'markdown',
              original_filename: 'assessment.md',
            },
            {
              artifact_id: 'art-engineer-output',
              case_id: 'case-001',
              type: 'implementation_summary',
              stage: 'execution',
              title: 'Engineer execution output',
              format: 'json',
              original_filename: 'engineer-output.json',
            },
            {
              artifact_id: 'art-patch',
              case_id: 'case-001',
              type: 'patch',
              stage: 'execution',
              title: 'Engineer patch',
              format: 'diff',
              original_filename: 'implementation.patch',
            },
          ],
          events: [
            {
              event_id: 'evt-fixing',
              case_id: 'case-001',
              kind: 'state_changed',
              actor_type: 'agent',
              actor_id: 'inspector',
              payload: { target_status: 'fixing' },
              created_at: '2026-04-20T08:05:00',
            },
            {
              event_id: 'evt-reviewing',
              case_id: 'case-001',
              kind: 'state_changed',
              actor_type: 'agent',
              actor_id: 'engineer',
              payload: { target_status: 'reviewing' },
              created_at: '2026-04-20T08:10:00',
            },
          ],
          chain: [],
          metrics: {},
        }));
        return;
      }

      if (requestUrl.pathname === '/api/artifacts/art-assessment/download' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/markdown' });
        res.end('# Inspector assessment\n');
        return;
      }

      if (requestUrl.pathname === '/api/artifacts/art-engineer-output/download' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          version: 1,
          summary: 'Patched runtime retry logic.',
          overview: 'Engineer patched the timeout handling path.',
          resultType: 'runtime_fix',
          riskLevel: 'medium',
          nextState: 'reviewing',
          recommendedNextAction: 'review_engineer_output',
          changedFiles: ['src/tools/retry.ts'],
          artifacts: [],
        }));
        return;
      }

      if (requestUrl.pathname === '/api/artifacts/art-patch/download' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/x-diff' });
        res.end('diff --git a/src/tools/retry.ts b/src/tools/retry.ts\n');
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
        res.end(JSON.stringify({ case_id: 'case-001', status: payload.to, updated_at: '2026-04-20T08:15:00' }));
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
