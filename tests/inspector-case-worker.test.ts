import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InspectorCaseStore } from '../src/roles/inspector-cat/utils/inspector-case-store';
import { InspectorCaseWorker } from '../src/roles/inspector-cat/inspector-case-worker';
import { InspectorReviewExecutor } from '../src/roles/inspector-cat/utils/inspector-agent-review-executor';

describe('InspectorCaseWorker', () => {
  let testRoot: string;
  let storeDir: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-inspector-worker-'));
    storeDir = path.join(testRoot, 'cases');
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('会自动处理 received case，并生成分析结果', async () => {
    const store = new InspectorCaseStore(storeDir);
    const reviews: string[] = [];
    const reviewExecutor: InspectorReviewExecutor = {
      async reviewCase(record, caseStore) {
        reviews.push(record.caseId);
        const caseDir = caseStore.getCaseDir(record.caseId);
        const reportPath = path.join(caseDir, 'agent-review.md');
        fs.writeFileSync(reportPath, '# 督察猫审查报告\n\n- 已通过 fake review executor 生成', 'utf-8');

        return {
          generatedAt: new Date().toISOString(),
          caseId: record.caseId,
          mode: 'agent_review',
          summary: {
            overview: '督察猫已接管材料并完成审查。',
            deliveryCount: 2,
            reportGenerated: true,
          },
          reportFilePath: 'agent-review.md',
          finalText: '已发送审查摘要',
          deliveries: [
            { type: 'text', text: '摘要' },
            { type: 'file', filePath: reportPath, fileName: 'agent-review.md' },
          ],
        };
      },
    };
    const logContent = [
      '[2026-02-25 22:05:58.704] [INFO] 新建飞书会话: user:ou_demo',
      '[2026-02-25 22:05:58.705] [INFO] [user:ou_demo] 收到消息: 在吗...',
      '[2026-02-25 22:05:58.727] [INFO] [Turn 1] 调用AI推理 (可用工具: 27个)',
      '[2026-02-25 22:06:03.136] [INFO] [Turn 1] 执行工具: execute_shell | 参数: {"command":"find \\"E:/demo\\" -maxdepth 2 -type f | head -20"}',
      "[2026-02-25 22:06:03.463] [INFO] [Turn 1] 工具完成: execute_shell | 耗时: 75ms | 结果: 命令执行失败: 'head' 不是内部或外部命令",
      '[2026-02-25 22:06:03.464] [WARN] [Turn 1] execute_shell 触发限流 (429)，5000ms 后重试 (1/2)',
      '[2026-02-25 22:06:06.207] [INFO] [Turn 1] AI最终回复: (empty)',
      '[2026-02-25 22:06:06.208] [INFO] [Metrics] AI调用: 1次, tokens: 20+6=26, 工具调用: 1次, 工具耗时: 75ms',
    ].join('\n');

    const created = await store.createCase({
      analysisType: 'runtime',
      source: 'test',
      userRequest: 'review this log',
      files: [
        {
          path: 'runtime.log',
          kind: 'runtime_log',
          contentBase64: Buffer.from(logContent, 'utf-8').toString('base64'),
        },
      ],
    });

    const worker = new InspectorCaseWorker({
      store,
      pollIntervalMs: 10_000,
      reviewExecutor,
    });

    await worker.runOnce();

    const record = await store.getCase(created.caseId);
    assert.ok(record);
    assert.strictEqual(record!.status, 'analyzed');
    assert.match(record!.resultSummary || '', /督察猫已接管材料并完成审查/);

    const result = await store.getResult(created.caseId) as any;
    assert.ok(result);
    assert.ok(result.summary);
    assert.strictEqual(result.mode, 'agent_review');
    assert.strictEqual(result.summary.reportGenerated, true);
    assert.strictEqual(result.deliveries.length, 2);
    assert.ok(fs.existsSync(path.join(store.getCaseDir(created.caseId), 'agent-review.md')));
    assert.deepStrictEqual(reviews, [created.caseId]);
  });
});
