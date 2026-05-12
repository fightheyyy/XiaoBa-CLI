import { describe, test } from 'node:test';
import * as assert from 'node:assert';
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
    assert.equal(result.summary.toolCalls, 1);
    assert.equal(result.summary.totalTokens, 13572);
    assert.equal(result.summary.issueCounts.restore_event, 1);
    assert.ok(result.cases.some(item => item.kind === 'runtime_restore'));
  });
});

describe('redactSensitiveText', () => {
  test('redacts common credential and private host patterns', () => {
    const redacted = redactSensitiveText('sshpass.exe -p "pw" ssh user@10.1.1.2 with {"apiKey":"abc"} in C:\\Users\\caoy\\demo');
    assert.ok(!redacted.includes('"pw"'));
    assert.ok(!redacted.includes('"abc"'));
    assert.ok(!redacted.includes('10.1.1.2'));
    assert.ok(!redacted.includes('caoy'));
  });
});
