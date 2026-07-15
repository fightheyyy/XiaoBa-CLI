import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TraceReplayReport, TraceReplayRunOptions } from '../src/replay/trace-replay-runner';
import { ReviewerTraceReplayTool } from '../src/roles/reviewer-cat/tools/trace-replay-tool';

describe('ReviewerTraceReplayTool', () => {
  const date = '2026-07-14';
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-reviewer-trace-replay-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('derives the frozen case from the DAG parent and writes fresh replay evidence under the fixed prefix', async () => {
    const sourceRef = writeFrozenInspectorCase(root, date);
    let captured: TraceReplayRunOptions | undefined;
    const sessionKeys: string[] = [];
    const tool = new ReviewerTraceReplayTool({
      replay: async options => {
        captured = options;
        sessionKeys.push(String(options.sessionKey));
        assert.strictEqual(options.cwd, fs.realpathSync(root));
        assert.strictEqual(options.outDir, path.join(fs.realpathSync(root), 'output', 'evolution', 'sleep', date, 'reviewer-replay'));
        assert.strictEqual(options.maxTurns, 1);
        assert.strictEqual(options.source, 'evolution-reviewer-trace-replay');
        assert.ok(options.services);

        const visibleTools = options.services!.toolManager.getToolDefinitions({
          surface: 'pet',
          channel: fakeChannel(),
        }).map(definition => definition.name).sort();
        assert.deepEqual(visibleTools, ['glob', 'grep', 'read_file']);

        const outDir = String(options.outDir);
        for (const [name, content] of [
          ['manifest.json', '{}\n'],
          ['extracted-inputs.json', '[]\n'],
          ['replay-results.json', '[]\n'],
          ['comparison.json', '{}\n'],
          ['report.md', '# fresh replay\n'],
        ]) {
          fs.writeFileSync(path.join(outDir, name), content, 'utf-8');
        }
        return fakeReport(options);
      },
    });

    const output = await tool.execute({}, dagContext(root, date));
    assert.strictEqual(typeof output, 'string');
    assert.match(String(output), /reviewer_trace_replay: status=completed/);
    assert.match(String(output), new RegExp(`report_ref=output/evolution/sleep/${date}/reviewer-replay/report\\.md`));
    assert.ok(captured?.services);

    const frozenTrace = fs.readFileSync(
      path.join(root, 'output', 'evolution', 'sleep', date, 'reviewer-replay', 'source-trace.jsonl'),
      'utf-8',
    ).trim().split('\n');
    assert.strictEqual(frozenTrace.length, 1);
    assert.strictEqual(JSON.parse(frozenTrace[0]).trace_id, 'trace-1');
    assert.match(sourceRef, /#trace-1$/);

    const deniedWrite = await captured!.services!.toolManager.executeTool({
      id: 'write-must-be-denied',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({ file_path: 'src/mutated.ts', content: 'bad' }),
      },
    }, [], {
      surface: 'pet',
      channel: fakeChannel(),
    });
    assert.strictEqual(deniedWrite.status, 'blocked');
    assert.strictEqual(deniedWrite.error_code, 'REVIEWER_TRACE_REPLAY_TOOL_FORBIDDEN');
    assert.strictEqual(fs.existsSync(path.join(root, 'src', 'mutated.ts')), false);

    const artifacts = tool.getArtifactManifest({}, String(output), dagContext(root, date));
    assert.deepEqual(artifacts.map(item => item.path), [
      `output/evolution/sleep/${date}/reviewer-replay/replay-case.json`,
      `output/evolution/sleep/${date}/reviewer-replay/source-trace.jsonl`,
      `output/evolution/sleep/${date}/reviewer-replay/manifest.json`,
      `output/evolution/sleep/${date}/reviewer-replay/extracted-inputs.json`,
      `output/evolution/sleep/${date}/reviewer-replay/replay-results.json`,
      `output/evolution/sleep/${date}/reviewer-replay/comparison.json`,
      `output/evolution/sleep/${date}/reviewer-replay/report.md`,
    ]);

    const secondOutput = await tool.execute({}, dagContext(root, date));
    assert.strictEqual(typeof secondOutput, 'string');
    assert.strictEqual(sessionKeys.length, 2);
    assert.notStrictEqual(sessionKeys[0], sessionKeys[1]);
    assert.match(sessionKeys[0], /evolution-replay-20260714-[0-9a-f-]{36}$/);
  });

  test('rejects model-supplied paths or commands before replay starts', async () => {
    let called = false;
    const tool = new ReviewerTraceReplayTool({
      replay: async options => {
        called = true;
        return fakeReport(options);
      },
    });

    const output = await tool.execute({
      inspector_ref: '../forged.json',
      cwd: '/tmp',
      command: 'touch bad',
    }, dagContext(root, date));

    assert.notStrictEqual(typeof output, 'string');
    if (typeof output === 'string') assert.fail('non-empty args must be blocked');
    assert.strictEqual(output.status, 'blocked');
    assert.strictEqual(output.error_code, 'REVIEWER_TRACE_REPLAY_REJECTED_ARGUMENTS');
    assert.strictEqual(called, false);
  });

  test('blocks a frozen source trace that escapes the workspace through a symlink', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-reviewer-trace-outside-'));
    try {
      const outsideTrace = path.join(outside, 'traces.jsonl');
      fs.writeFileSync(outsideTrace, `${JSON.stringify(traceRow('trace-escape', 'read only'))}\n`, 'utf-8');
      const traceDir = path.join(root, 'logs', 'sessions', 'unsafe');
      fs.mkdirSync(traceDir, { recursive: true });
      fs.symlinkSync(outsideTrace, path.join(traceDir, 'traces.jsonl'));
      writeInspectorRoute(root, date, 'logs/sessions/unsafe/traces.jsonl#trace-escape');

      let called = false;
      const tool = new ReviewerTraceReplayTool({
        replay: async options => {
          called = true;
          return fakeReport(options);
        },
      });
      const output = await tool.execute({}, dagContext(root, date));

      assert.notStrictEqual(typeof output, 'string');
      if (typeof output === 'string') assert.fail('escaping source trace must be blocked');
      assert.strictEqual(output.status, 'blocked');
      assert.strictEqual(output.error_code, 'REVIEWER_TRACE_REPLAY_BLOCKED');
      assert.match(String(output.blocked_reason), /escapes the workspace/);
      assert.strictEqual(called, false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('replays a non-Base trace against its original callable Role in the read-only runtime', async () => {
    writeReplayRole(root, 'engineer-cat');
    const traceDir = path.join(root, 'logs', 'sessions', 'non-base');
    fs.mkdirSync(traceDir, { recursive: true });
    const row = traceRow('trace-non-base', 'review role-specific behavior', { roleName: 'engineer-cat' });
    fs.writeFileSync(path.join(traceDir, 'traces.jsonl'), `${JSON.stringify(row)}\n`, 'utf-8');
    writeInspectorRoute(root, date, 'logs/sessions/non-base/traces.jsonl#trace-non-base');
    let captured: TraceReplayRunOptions | undefined;
    const tool = new ReviewerTraceReplayTool({
      replay: async options => {
        captured = options;
        for (const [name, content] of [
          ['manifest.json', '{}\n'],
          ['extracted-inputs.json', '[]\n'],
          ['replay-results.json', '[]\n'],
          ['comparison.json', '{}\n'],
          ['report.md', '# fresh role replay\n'],
        ]) {
          fs.writeFileSync(path.join(String(options.outDir), name), content, 'utf-8');
        }
        return fakeReport(options);
      },
    });

    const output = await tool.execute({}, dagContext(root, date));
    assert.strictEqual(typeof output, 'string');
    assert.match(String(output), /target_role=engineer-cat/);
    assert.match(String(captured?.sessionKey), /role-engineer-cat/);
    assert.strictEqual(captured?.services?.roleName, 'engineer-cat');
  });

  test('fails closed for side-effecting source traces', async () => {
    for (const testCase of [{
      name: 'side-effect',
      row: traceRow('trace-side-effect', 'create a production file', { toolNames: ['write_file'] }),
      expected: /requires non-read-only tools \(write_file\)/,
    }]) {
      const traceDir = path.join(root, 'logs', 'sessions', testCase.name);
      fs.mkdirSync(traceDir, { recursive: true });
      fs.writeFileSync(path.join(traceDir, 'traces.jsonl'), `${JSON.stringify(testCase.row)}\n`, 'utf-8');
      const sourceRef = `logs/sessions/${testCase.name}/traces.jsonl#${testCase.row.trace_id}`;
      writeInspectorRoute(root, date, sourceRef);
      let called = false;
      const tool = new ReviewerTraceReplayTool({
        replay: async options => {
          called = true;
          return fakeReport(options);
        },
      });

      const output = await tool.execute({}, dagContext(root, date));
      assert.notStrictEqual(typeof output, 'string');
      if (typeof output === 'string') assert.fail(`${testCase.name} replay must be blocked`);
      assert.strictEqual(output.status, 'blocked');
      assert.match(String(output.blocked_reason), testCase.expected);
      assert.strictEqual(called, false);
    }
  });

  test('rejects a Replay Case that merges traces from different source sessions', async () => {
    const traceDir = path.join(root, 'logs', 'sessions', 'mixed');
    fs.mkdirSync(traceDir, { recursive: true });
    const tracePath = path.join(traceDir, 'traces.jsonl');
    fs.writeFileSync(tracePath, [
      JSON.stringify(traceRow('mixed-a', 'first request', { sessionId: 'pet:xiaoba:source-a', timestamp: '2026-07-14T10:00:00.000Z' })),
      JSON.stringify(traceRow('mixed-b', 'unrelated request', { sessionId: 'pet:xiaoba:source-b', timestamp: '2026-07-14T11:00:00.000Z' })),
      '',
    ].join('\n'), 'utf-8');
    writeInspectorRoute(root, date, [
      'logs/sessions/mixed/traces.jsonl#mixed-a',
      'logs/sessions/mixed/traces.jsonl#mixed-b',
    ]);

    let called = false;
    const tool = new ReviewerTraceReplayTool({
      replay: async options => {
        called = true;
        return fakeReport(options);
      },
    });
    const output = await tool.execute({}, dagContext(root, date));

    assert.notStrictEqual(typeof output, 'string');
    if (typeof output === 'string') assert.fail('mixed-session replay must be blocked');
    assert.strictEqual(output.status, 'blocked');
    assert.match(String(output.blocked_reason), /one original session/);
    assert.strictEqual(called, false);
  });

  test('removes partial replay artifacts when post-run safety validation blocks', async () => {
    writeFrozenInspectorCase(root, date);
    const replayRoot = path.join(root, 'output', 'evolution', 'sleep', date, 'reviewer-replay');
    const tool = new ReviewerTraceReplayTool({
      replay: async options => {
        for (const name of ['manifest.json', 'replay-results.json', 'comparison.json', 'report.md']) {
          fs.writeFileSync(path.join(String(options.outDir), name), '{}\n', 'utf-8');
        }
        const report = fakeReport(options);
        report.results = [{ tools: ['write_file'] } as any];
        return report;
      },
    });

    const output = await tool.execute({}, dagContext(root, date));
    assert.notStrictEqual(typeof output, 'string');
    if (typeof output === 'string') assert.fail('unsafe replay must be blocked');
    assert.strictEqual(output.status, 'blocked');
    assert.match(String(output.blocked_reason), /attempted forbidden tools/);
    assert.strictEqual(fs.existsSync(replayRoot), false);
  });
});

function writeReplayRole(root: string, roleName: string): void {
  const roleRoot = path.join(root, 'roles', roleName);
  fs.mkdirSync(path.join(roleRoot, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(roleRoot, 'role.json'), JSON.stringify({
    name: roleName,
    displayName: 'EngineerCat',
    description: 'Read-only replay target.',
    promptFile: 'system.md',
    status: 'active',
  }), 'utf-8');
  fs.writeFileSync(path.join(roleRoot, 'prompts', 'system.md'), 'Inspect evidence without side effects.\n', 'utf-8');
}

function writeFrozenInspectorCase(root: string, date: string): string {
  const traceDir = path.join(root, 'logs', 'sessions', 'pet', 'session-a');
  fs.mkdirSync(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, 'traces.jsonl');
  fs.writeFileSync(tracePath, [
    JSON.stringify(traceRow('trace-1', '请读取当前状态并解释失败原因')),
    JSON.stringify(traceRow('trace-2', '这条不是冻结 Replay Case 的一部分')),
    '',
  ].join('\n'), 'utf-8');
  const ref = 'logs/sessions/pet/session-a/traces.jsonl#trace-1';
  writeInspectorRoute(root, date, ref);
  return ref;
}

function writeInspectorRoute(root: string, date: string, sourceRef: string | string[]): void {
  const sourceRefs = Array.isArray(sourceRef) ? sourceRef : [sourceRef];
  const runRoot = path.join(root, 'output', 'evolution', 'sleep', date);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, 'inspector-route.json'), JSON.stringify({
    version: 1,
    route: 'replay',
    summary: 'frozen replay',
    finding_refs: ['finding:1'],
    evidence_refs: sourceRefs,
    replay_case: {
      id: 'retry-case',
      intent: 'repeat the frozen source trace in a clean session',
      expected_outcome: 'stable visible result',
      source_trace_refs: sourceRefs,
    },
  }, null, 2), 'utf-8');
}

function traceRow(
  traceId: string,
  userText: string,
  options: {
    roleName?: string;
    toolNames?: string[];
    sessionId?: string;
    timestamp?: string;
    traceIndex?: number;
  } = {},
) {
  return {
    entry_type: 'trace',
    trace_id: traceId,
    timestamp: options.timestamp || '2026-07-14T12:00:00.000Z',
    session_id: options.sessionId || 'pet:xiaoba:role-base:source',
    session_type: 'pet',
    ...(options.traceIndex !== undefined ? { trace_index: options.traceIndex } : {}),
    ...(options.roleName ? { role_name: options.roleName } : {}),
    user: { text: userText },
    assistant: {
      text: 'source response',
      tool_calls: (options.toolNames || []).map(name => ({ name })),
    },
    events: [{ event_type: 'session_completed', status: 'success' }],
  };
}

function dagContext(root: string, date: string) {
  return {
    workingDirectory: root,
    conversationHistory: [],
    roleName: 'reviewer-cat',
    parentSessionId: `evolution:dag:${date}`,
  };
}

function fakeChannel() {
  return {
    chatId: 'reviewer-replay-test',
    reply: async () => undefined,
    sendFile: async () => undefined,
  };
}

function fakeReport(options: TraceReplayRunOptions): TraceReplayReport {
  const outDir = String(options.outDir);
  return {
    replay_version: '0.1',
    run_id: 'trace-replay-test',
    generated_at: '2026-07-15T00:00:00.000Z',
    input_trace_path: String(options.tracePath),
    out_dir: outDir,
    pet_id: 'xiaoba',
    session_key: String(options.sessionKey),
    replayed_turns: Number(options.maxTurns),
    artifacts: {
      manifest_path: path.join(outDir, 'manifest.json'),
      extracted_inputs_path: path.join(outDir, 'extracted-inputs.json'),
      replay_results_path: path.join(outDir, 'replay-results.json'),
      comparison_path: path.join(outDir, 'comparison.json'),
      report_path: path.join(outDir, 'report.md'),
    },
    inputs: [],
    results: [],
    comparison: {
      oldTrace: emptyFacts(),
      newTrace: emptyFacts(),
      inputCountMatches: true,
      userInputsReplayed: true,
      slashCommandsMissingFromTrace: false,
      notes: [],
    },
  };
}

function emptyFacts() {
  return {
    traceCount: 0,
    userTexts: [],
    toolCounts: {},
    deliveryEvidenceCount: 0,
    visibleCompletedCount: 0,
    finalVisibleCount: 0,
    failedTools: [],
  };
}
