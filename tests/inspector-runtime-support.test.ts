import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InspectorReviewExecutor } from '../src/roles/inspector-cat/utils/inspector-agent-review-executor';
import { InspectorCaseStore } from '../src/roles/inspector-cat/utils/inspector-case-store';
import { InspectorRuntimeSupport } from '../src/roles/inspector-cat/utils/inspector-runtime-support';

describe('InspectorRuntimeSupport', () => {
  let testRoot: string;
  let support: InspectorRuntimeSupport | null = null;
  const originalInspectorApiKey = process.env.INSPECTOR_SERVER_API_KEY;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-inspector-runtime-'));
    delete process.env.INSPECTOR_SERVER_API_KEY;
  });

  afterEach(async () => {
    if (support) {
      await support.stop();
      support = null;
    }
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    if (typeof originalInspectorApiKey === 'string') {
      process.env.INSPECTOR_SERVER_API_KEY = originalInspectorApiKey;
    } else {
      delete process.env.INSPECTOR_SERVER_API_KEY;
    }
  });

  test('可以在独立 runtime 里收日志并自动分析', async () => {
    const store = new InspectorCaseStore(path.join(testRoot, 'data', 'inspector-cases'));
    const reviewExecutor: InspectorReviewExecutor = {
      async reviewCase(record, caseStore) {
        const caseDir = caseStore.getCaseDir(record.caseId);
        const reportPath = path.join(caseDir, 'agent-review.md');
        fs.writeFileSync(reportPath, '# fake report', 'utf-8');
        return {
          generatedAt: new Date().toISOString(),
          caseId: record.caseId,
          mode: 'agent_review',
          summary: {
            overview: '督察猫 hook 已转交材料，session 已完成审查。',
            deliveryCount: 2,
            reportGenerated: true,
          },
          reportFilePath: 'agent-review.md',
          finalText: 'ok',
          deliveries: [
            { type: 'text', text: '摘要' },
            { type: 'file', filePath: reportPath, fileName: 'agent-review.md' },
          ],
        };
      },
    };
    support = new InspectorRuntimeSupport({
      workingDirectory: testRoot,
      host: '127.0.0.1',
      port: 0,
      pollIntervalMs: 50,
      caseStore: store,
      reviewExecutor,
    });

    await support.start();

    const logContent = [
      '[2026-02-25 22:05:58.704] [INFO] 新建飞书会话: user:ou_demo',
      '[2026-02-25 22:05:58.705] [INFO] [user:ou_demo] 收到消息: 在吗...',
      '[2026-02-25 22:06:03.136] [INFO] [Turn 1] 执行工具: execute_shell | 参数: {"command":"find \\"E:/demo\\" -maxdepth 2 -type f | head -20"}',
      "[2026-02-25 22:06:03.463] [INFO] [Turn 1] 工具完成: execute_shell | 耗时: 75ms | 结果: 命令执行失败: 'head' 不是内部或外部命令",
      '[2026-02-25 22:06:06.208] [INFO] [Metrics] AI调用: 1次, tokens: 20+6=26, 工具调用: 1次, 工具耗时: 75ms',
    ].join('\n');

    const createResponse = await fetch(`${support.getBaseUrl()}/api/inspector/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisType: 'runtime',
        source: 'test-runtime-support',
        userRequest: 'review this log',
        files: [
          {
            path: 'logs/2026-02-25/runtime.log',
            kind: 'runtime_log',
            contentBase64: Buffer.from(logContent, 'utf-8').toString('base64'),
          },
        ],
      }),
    });

    assert.strictEqual(createResponse.status, 201);
    const created = await createResponse.json() as { caseId: string };
    assert.ok(created.caseId);

    const result = await waitForResult(`${support.getBaseUrl()}/api/inspector/cases/${created.caseId}/result`, 40, 100);
    assert.strictEqual(result.status, 'analyzed');
    assert.match(result.resultSummary || '', /督察猫 hook 已转交材料/);
    assert.strictEqual(result.result.mode, 'agent_review');
    assert.strictEqual(result.result.summary.reportGenerated, true);
  });

  test('支持先建 case 再用 multipart 上传日志文件，并在完成上传后再触发分析', async () => {
    const store = new InspectorCaseStore(path.join(testRoot, 'data', 'inspector-cases'));
    const reviewExecutor: InspectorReviewExecutor = {
      async reviewCase(record, caseStore) {
        const caseDir = caseStore.getCaseDir(record.caseId);
        const reportPath = path.join(caseDir, 'agent-review.md');
        fs.writeFileSync(reportPath, '# fake report', 'utf-8');
        return {
          generatedAt: new Date().toISOString(),
          caseId: record.caseId,
          mode: 'agent_review',
          summary: {
            overview: 'multipart upload ok',
            deliveryCount: 1,
            reportGenerated: true,
          },
          reportFilePath: 'agent-review.md',
          finalText: 'ok',
          deliveries: [{ type: 'text', text: '摘要' }],
        };
      },
    };

    support = new InspectorRuntimeSupport({
      workingDirectory: testRoot,
      host: '127.0.0.1',
      port: 0,
      pollIntervalMs: 50,
      caseStore: store,
      reviewExecutor,
    });

    await support.start();

    const createResponse = await fetch(`${support.getBaseUrl()}/api/inspector/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisType: 'runtime',
        source: 'multipart-test',
        userRequest: 'upload later',
      }),
    });
    assert.strictEqual(createResponse.status, 201);
    const created = await createResponse.json() as { caseId: string };

    const boundary = '----xiaoba-test-boundary';
    const fileContent = '[INFO] multipart log\n';
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="path"\r\n\r\nlogs/2026-02-25/runtime.log\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nruntime_log\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="runtime.log"\r\nContent-Type: text/plain\r\n\r\n${fileContent}\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const uploadResponse = await fetch(`${support.getBaseUrl()}/api/inspector/cases/${created.caseId}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    assert.strictEqual(uploadResponse.status, 201);

    const pending = await (await fetch(`${support.getBaseUrl()}/api/inspector/cases/${created.caseId}`)).json() as { status: string };
    assert.strictEqual(pending.status, 'uploading');

    const completeResponse = await fetch(`${support.getBaseUrl()}/api/inspector/cases/${created.caseId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.strictEqual(completeResponse.status, 200);

    const result = await waitForResult(`${support.getBaseUrl()}/api/inspector/cases/${created.caseId}/result`, 40, 100);
    assert.strictEqual(result.status, 'analyzed');
    assert.match(result.resultSummary || '', /multipart upload ok/);
  });
});

async function waitForResult(url: string, maxAttempts: number, delayMs: number): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'analyzed' || data.status === 'failed') {
      return data;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error('Timed out waiting for inspector result');
}
