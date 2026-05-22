import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  redactSensitiveText,
  runLegacyTraceBenchmark,
} from '../src/harness/legacy-trace-benchmark';

describe('legacy trace benchmark', () => {
  test('normalizes mixed legacy turn and runtime JSONL without leaking text by default', () => {
    const legacyTurn = {
      turn: 1,
      timestamp: '2026-04-08T08:34:24.453Z',
      session_id: 'cc_group:demo',
      session_type: 'catscompany',
      user: { text: '帮我打开页面' },
      assistant: {
        text: '我先试一下浏览器工具',
        tool_calls: [
          {
            id: 'call-1',
            name: 'execute_shell',
            arguments: '{"command":"curl -s https://example.com | head -20"}',
            result: "'head' is not recognized as an internal or external command",
            duration_ms: 25,
          },
          {
            id: 'call-2',
            name: 'read_file',
            arguments: '{"file_path":"servers_config.json"}',
            result: '{"password":"secret-value"}',
            duration_ms: 1,
          },
        ],
      },
      tokens: { prompt: 100, completion: 20 },
    };
    const runtimeEntry = {
      entry_type: 'runtime',
      timestamp: '2026-04-08T08:34:25.453Z',
      session_id: 'cc_group:demo',
      session_type: 'catscompany',
      level: 'INFO',
      message: '[会话 cc_group:demo] 已恢复 19 条消息',
    };

    const result = runLegacyTraceBenchmark([
      {
        path: 'sessions/catscompany/2026-04-08/cc_group_demo.jsonl',
        content: `${JSON.stringify(legacyTurn)}\n${JSON.stringify(runtimeEntry)}\n`,
      },
    ]);

    assert.equal(result.summary.files, 1);
    assert.equal(result.summary.turnEntries, 1);
    assert.equal(result.summary.runtimeEntries, 1);
    assert.equal(result.summary.episodes, 1);
    assert.equal(result.summary.toolCalls, 2);
    assert.equal(result.summary.toolFailures, 1);
    assert.equal(result.summary.redactionHits, 1);
    assert.equal(result.summary.issueCounts.platform_command_mismatch, 1);
    assert.equal(result.summary.issueCounts.credential_exposure, 1);
    assert.equal(result.summary.issueCounts.restore_event, 1);

    const executeShell = result.toolStats.find(tool => tool.name === 'execute_shell');
    assert.ok(executeShell);
    assert.equal(executeShell.failures, 1);

    assert.ok(result.cases.length > 0);
    assert.equal(result.cases[0].sourceEpisodeId, result.episodes[0].episodeId);
    assert.equal(result.cases[0].caseCategory, 'runtime_case');
    assert.ok(result.cases.every(item => !item.preview));
    assert.ok(JSON.stringify(result).includes('secret-value') === false);
  });

  test('includeText writes redacted previews for local review', () => {
    const result = runLegacyTraceBenchmark([
      {
        path: 'sessions/weixin/2026-04-09/user_demo.jsonl',
        content: `${JSON.stringify({
          turn: 1,
          timestamp: '2026-04-09T10:00:00.000Z',
          session_id: 'user:demo',
          session_type: 'weixin',
          user: { text: '登录服务器 password="secret-value"' },
          assistant: {
            text: '执行 sshpass -p "secret-value" ssh user@10.1.1.2',
            tool_calls: [],
          },
          tokens: { prompt: 96001, completion: 12 },
        })}\n`,
      },
    ], { includeText: true });

    assert.equal(result.summary.issueCounts.context_pressure, 1);
    assert.equal(result.summary.episodes, 1);
    assert.ok(result.cases.length > 0);
    assert.ok(result.cases[0].preview);
    assert.ok(JSON.stringify(result.cases[0].preview).includes('secret-value') === false);
    assert.ok(JSON.stringify(result.cases[0].preview).includes('[REDACTED]'));
    assert.ok(JSON.stringify(result.cases[0].preview).includes('[PRIVATE_IP]'));
  });

  test('runtime-only traces still produce restore benchmark cases', () => {
    const result = runLegacyTraceBenchmark([
      {
        path: 'sessions/catscompany/2026-05-08/catscompany_cc_user_demo.jsonl',
        content: [
          {
            entry_type: 'runtime',
            timestamp: '2026-05-08T01:43:01.281Z',
            session_id: 'cc_user:demo',
            session_type: 'catscompany',
            level: 'INFO',
            message: '[会话 cc_user:demo] 标记从 DB 恢复 19 条消息',
          },
          {
            entry_type: 'runtime',
            timestamp: '2026-05-08T01:43:26.062Z',
            session_id: 'cc_user:demo',
            session_type: 'catscompany',
            level: 'INFO',
            message: '[cc_user:demo Turn 1] AI返回 tokens: 11425+2147=13572',
          },
          {
            entry_type: 'runtime',
            timestamp: '2026-05-08T01:43:26.063Z',
            session_id: 'cc_user:demo',
            session_type: 'catscompany',
            level: 'INFO',
            message: '[cc_user:demo Turn 1] 执行工具: edit_file | 参数: {"file_path":"a.R"}',
          },
          {
            entry_type: 'runtime',
            timestamp: '2026-05-08T01:43:26.064Z',
            session_id: 'cc_user:demo',
            session_type: 'catscompany',
            level: 'INFO',
            message: '[cc_user:demo Turn 1] 工具完成: edit_file | 耗时: 4ms | 结果: 成功编辑文件',
          },
        ].map(entry => JSON.stringify(entry)).join('\n'),
      },
    ]);

    assert.equal(result.summary.turnEntries, 0);
    assert.equal(result.summary.runtimeEntries, 4);
    assert.equal(result.summary.episodes, 1);
    assert.equal(result.summary.toolCalls, 1);
    assert.equal(result.summary.totalTokens, 13572);
    assert.equal(result.summary.issueCounts.restore_event, 1);
    assert.ok(result.cases.some(item => item.kind === 'runtime_restore'));
  });

  test('prefers structured logger fields for artifacts, skill ids, status, and error codes', () => {
    const result = runLegacyTraceBenchmark([
      {
        path: 'sessions/catscompany/2026-04-12/structured.jsonl',
        content: `${JSON.stringify({
          schema_version: 2,
          entry_type: 'turn',
          turn_id: 'demo.turn.1',
          turn: 1,
          timestamp: '2026-04-12T01:00:00.000Z',
          session_id: 'bio:structured',
          session_type: 'catscompany',
          user: { text: '画图并发我' },
          assistant: {
            text: '已处理',
            tool_calls: [
              {
                id: 'call-1',
                tool_call_id: 'demo.turn.1.tool.1',
                name: 'skill',
                skill_id: 'seurat-plotting',
                arguments: { skill: 'seurat-plotting' },
                result: 'activated',
                status: 'success',
                artifact_manifest: [
                  { path: '/share/home/example-user/project/output/CD3D_feature.png', type: 'png', action: 'created' },
                ],
              },
              {
                id: 'call-2',
                name: 'execute_shell',
                arguments: { command: 'Rscript plot.R' },
                result: 'blocked',
                status: 'failure',
                error_code: 'PATH_DENIED',
              },
            ],
          },
          tokens: { prompt: 300, completion: 40 },
        })}\n`,
      },
    ], {
      benchmarkName: 'BioBench',
      domain: 'bioinformatics',
      domainSubtype: 'single_cell_seurat',
    });

    assert.equal(result.summary.issueCounts.outside_read_blocked, 1);
    assert.equal(result.episodes[0].skillsTriggered[0], 'seurat-plotting');
    assert.ok(result.episodes[0].artifactsObserved.includes('/share/home/[USER]/project/output/CD3D_feature.png'));
    assert.equal(result.episodes[0].failedToolCalls, 1);
    assert.equal(result.cases[0].caseCategory, 'hybrid_case');
  });

  test('extracts episode-level cases with skill, tool, artifact, and routing metadata', () => {
    const trace = [
      {
        turn: 1,
        timestamp: '2026-04-10T01:00:00.000Z',
        session_id: 'bio:user',
        session_type: 'catscompany',
        user: { text: '进入服务器 /share/home/example-user/project 看一下 Seurat 对象' },
        assistant: {
          text: '我先查看目录和对象',
          tool_calls: [
            {
              name: 'execute_shell',
              arguments: '{"command":"ssh biohost ls /share/home/example-user/project"}',
              result: 'merge.Rds\nmarkers.csv',
              duration_ms: 10,
            },
          ],
        },
        tokens: { prompt: 1200, completion: 80 },
      },
      {
        turn: 2,
        timestamp: '2026-04-10T01:03:00.000Z',
        session_id: 'bio:user',
        session_type: 'catscompany',
        user: { text: '用 seurat plotting skill 画 CD3D 的 FeaturePlot，保存 png' },
        assistant: {
          text: '我会激活绘图流程并运行 Rscript',
          tool_calls: [
            {
              name: 'skill',
              arguments: '{"skill":"seurat-plotting"}',
              result: 'Skill "seurat-plotting" 已激活',
              duration_ms: 3,
            },
            {
              name: 'execute_shell',
              arguments: '{"command":"Rscript plot_feature.R"}',
              result: 'saved /share/home/example-user/project/output/CD3D_feature.png',
              duration_ms: 1200,
            },
          ],
        },
        tokens: { prompt: 2200, completion: 160 },
      },
      {
        turn: 3,
        timestamp: '2026-04-10T01:04:00.000Z',
        session_id: 'bio:user',
        session_type: 'catscompany',
        user: { text: '发我图片' },
        assistant: {
          text: '图片已生成，我发送给你',
          tool_calls: [
            {
              name: 'send_file',
              arguments: '{"file_path":"/share/home/example-user/project/output/CD3D_feature.png"}',
              result: 'sent',
              duration_ms: 20,
            },
          ],
        },
        tokens: { prompt: 500, completion: 30 },
      },
      {
        turn: 4,
        timestamp: '2026-04-10T01:06:00.000Z',
        session_id: 'bio:user',
        session_type: 'catscompany',
        user: { text: '现在请把这个流程打包成 skill' },
        assistant: {
          text: '我会整理成可复用 skill',
          tool_calls: [
            {
              name: 'write_file',
              arguments: '{"file_path":"skills/seurat-plotting/SKILL.md"}',
              result: 'ok',
              duration_ms: 4,
            },
          ],
        },
        tokens: { prompt: 900, completion: 100 },
      },
    ].map(entry => JSON.stringify(entry)).join('\n');

    const result = runLegacyTraceBenchmark([
      { path: 'sessions/catscompany/2026-04-10/bio.jsonl', content: trace },
    ], {
      benchmarkName: 'BioBench',
      domain: 'bioinformatics',
      domainSubtype: 'single_cell_seurat',
      maxCases: 10,
      includeText: true,
    });

    assert.equal(result.summary.episodes, 2);
    assert.equal(result.episodes[0].turnCount, 3);
    assert.equal(result.episodes[0].toolCallCount, 4);
    assert.equal(result.episodes[0].successfulToolCalls, 4);
    assert.equal(result.episodes[0].failedToolCalls, 0);
    assert.equal(result.episodes[0].toolSuccessRate, 1);
    assert.equal(result.episodes[0].promptTokens, 3900);
    assert.equal(result.episodes[0].completionTokens, 270);
    assert.equal(result.episodes[0].totalTokens, 4170);
    assert.equal(result.datasetCard.totalTokens, 5170);
    assert.equal(result.datasetCard.p50TokensPerEpisode, 1000);
    assert.equal(result.datasetCard.p90TokensPerEpisode, 4170);
    assert.equal(result.episodes[0].skillsTriggered[0], 'seurat-plotting');
    assert.equal(result.episodes[0].taskType, 'plot_generation');
    assert.equal(result.episodes[0].requiresArtifact, true);
    assert.equal(result.episodes[0].requiresRemoteFixture, true);

    const plotCase = result.cases.find(item => item.sourceEpisodeId === result.episodes[0].episodeId);
    assert.ok(plotCase);
    assert.equal(plotCase.caseCategory, 'skill_case');
    assert.equal(plotCase.domain, 'bioinformatics');
    assert.equal(plotCase.totalTokens, 4170);
    assert.equal(plotCase.promptTokens, 3900);
    assert.equal(plotCase.completionTokens, 270);
    assert.deepEqual(plotCase.skillsTriggered, ['seurat-plotting']);
    assert.ok(plotCase.artifactsObserved.some(item => item.includes('CD3D_feature.png')));

    const packagingCase = result.cases.find(item => item.taskType === 'workflow_packaging');
    assert.ok(packagingCase);
    assert.equal(packagingCase.caseCategory, 'skill_case');
  });

  test('CLI writes episode and dataset-card artifacts', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-trace-benchmark-'));
    const sourceDir = path.join(tempRoot, 'sessions');
    const outDir = path.join(tempRoot, 'out');
    fs.mkdirSync(path.join(sourceDir, 'catscompany', '2026-04-11'), { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'catscompany', '2026-04-11', 'bio.jsonl'),
      `${JSON.stringify({
        turn: 1,
        timestamp: '2026-04-11T01:00:00.000Z',
        session_id: 'bio:cli',
        session_type: 'catscompany',
        user: { text: '读取 Seurat metadata 并总结 cluster' },
        assistant: {
          text: '开始读取',
          tool_calls: [
            {
              name: 'read_file',
              arguments: '{"file_path":"metadata.csv"}',
              result: 'cluster,celltype',
              duration_ms: 1,
            },
          ],
        },
        tokens: { prompt: 100, completion: 20 },
      })}\n`,
      'utf-8',
    );

    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
    execFileSync(tsxBin, [
      'scripts/legacy-trace-benchmark.ts',
      sourceDir,
      '--out',
      outDir,
      '--topic',
      'BioBench',
      '--max-cases',
      '5',
    ], { cwd: process.cwd(), encoding: 'utf-8' });

    const benchmark = JSON.parse(fs.readFileSync(path.join(outDir, 'benchmark.json'), 'utf-8'));
    const episodes = fs.readFileSync(path.join(outDir, 'episodes.jsonl'), 'utf-8').trim().split(/\r?\n/);
    const cases = fs.readFileSync(path.join(outDir, 'cases.jsonl'), 'utf-8').trim().split(/\r?\n/);
    const datasetCard = fs.readFileSync(path.join(outDir, 'dataset-card.md'), 'utf-8');

    assert.equal(benchmark.summary.episodes, 1);
    assert.equal(benchmark.summary.avgTokensPerEpisode, 120);
    assert.equal(benchmark.cases[0].totalTokens, 120);
    assert.equal(episodes.length, 1);
    assert.equal(cases.length, 1);
    assert.match(datasetCard, /BioBench Dataset Card/);
    assert.match(datasetCard, /episodes: 1/);
  });
});

describe('redactSensitiveText', () => {
  test('redacts common credential and private host patterns', () => {
    const redacted = redactSensitiveText('sshpass.exe -p "fake-password" ssh user@10.1.1.2 with {"apiKey":"fake-key"} in C:\\Users\\example-user\\demo and C://Users//example-user//demo 密码为fake-secret');
    assert.ok(!redacted.includes('"fake-password"'));
    assert.ok(!redacted.includes('"fake-key"'));
    assert.ok(!redacted.includes('10.1.1.2'));
    assert.ok(!redacted.includes('example-user'));
    assert.ok(!redacted.includes('fake-secret'));
  });
});
