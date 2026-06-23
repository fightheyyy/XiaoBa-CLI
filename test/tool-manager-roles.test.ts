import { after, afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRoleAwareToolManager } from '../src/bootstrap/tool-manager';
import { CodexJobCancelTool, CodexJobResumeTool, CodexJobStartTool, CodexJobStatusTool } from '../src/roles/reviewer-cat/tools/codex-job-tools';
import { ToolManager } from '../src/tools/tool-manager';
import { RoleResolver } from '../src/utils/role-resolver';

const originalCwd = process.cwd();
const originalRole = process.env.XIAOBA_ROLE;
const originalCurrentRole = process.env.CURRENT_ROLE;
const originalCurrentRoleDisplayName = process.env.CURRENT_ROLE_DISPLAY_NAME;
const originalCodexHome = process.env.CODEX_HOME;

describe('ToolManager role-specific tools', () => {
  let testRoot: string;

  beforeEach(() => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-tool-role-'));
    fs.mkdirSync(path.join(testRoot, 'roles', 'InspectorCat'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'roles', 'reviewer-cat'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'roles', 'engineer-cat'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'roles', 'researcher-cat'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'roles', 'secretary-cat'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'roles', 'guide'), { recursive: true });
    fs.writeFileSync(
      path.join(testRoot, 'roles', 'InspectorCat', 'role.json'),
      JSON.stringify({ name: 'inspector-cat', displayName: 'InspectorCat' }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(testRoot, 'roles', 'reviewer-cat', 'role.json'),
      JSON.stringify({ name: 'reviewer-cat', displayName: 'ReviewerCat' }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(testRoot, 'roles', 'engineer-cat', 'role.json'),
      JSON.stringify({ name: 'engineer-cat', displayName: 'EngineerCat' }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(testRoot, 'roles', 'researcher-cat', 'role.json'),
      JSON.stringify({ name: 'researcher-cat', displayName: 'ResearcherCat', aliases: ['researcher'] }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(testRoot, 'roles', 'secretary-cat', 'role.json'),
      JSON.stringify({
        name: 'secretary-cat',
        displayName: 'SecretaryCat',
        aliases: ['secretary'],
        inheritBaseTools: false,
        baseToolAllowlist: ['skill'],
      }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(testRoot, 'roles', 'guide', 'role.json'),
      JSON.stringify({ name: 'guide', displayName: 'Guide', aliases: ['tpc-guide'] }, null, 2),
      'utf-8',
    );
    process.chdir(testRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  after(() => {
    if (originalRole) {
      process.env.XIAOBA_ROLE = originalRole;
    } else {
      delete process.env.XIAOBA_ROLE;
    }
    if (originalCurrentRole) {
      process.env.CURRENT_ROLE = originalCurrentRole;
    } else {
      delete process.env.CURRENT_ROLE;
    }
    if (originalCurrentRoleDisplayName) {
      process.env.CURRENT_ROLE_DISPLAY_NAME = originalCurrentRoleDisplayName;
    } else {
      delete process.env.CURRENT_ROLE_DISPLAY_NAME;
    }
    if (originalCodexHome) {
      process.env.CODEX_HOME = originalCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
  });

  test('默认角色不注册 Inspector 专属工具', () => {
    const manager = new ToolManager();
    assert.strictEqual(manager.getTool('analyze_log'), undefined);
  });

  test('激活角色后基础 ToolManager 仍保持纯 runtime 工具集', () => {
    RoleResolver.activateRole('inspector-cat');
    const manager = new ToolManager();
    assert.strictEqual(manager.getTool('analyze_log'), undefined);
  });

  test('inspector-cat 角色通过组合层注册 analyze_log', () => {
    RoleResolver.activateRole('inspector-cat');
    const manager = createRoleAwareToolManager();
    assert.ok(manager.getTool('analyze_log'));
  });

  test('inspector-cat analyze_log 显式声明 source log 证据', async () => {
    RoleResolver.activateRole('inspector-cat');
    const logDir = path.join(testRoot, 'logs', 'sessions');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'inspector-source.jsonl'),
      `${JSON.stringify({
        schema_version: 2,
        entry_type: 'turn',
        turn: 1,
        timestamp: '2026-06-04T00:00:00.000Z',
        session_id: 'inspector-source',
        session_type: 'eval',
        user: { text: 'inspect runtime evidence' },
        assistant: { text: 'I found a concrete failure.', tool_calls: [] },
        tokens: { prompt: 10, completion: 5 },
      })}\n`,
      'utf-8',
    );

    const manager = createRoleAwareToolManager(testRoot);
    const result = await manager.executeTool({
      id: 'inspector-analyze-log-manifest-1',
      type: 'function',
      function: {
        name: 'analyze_log',
        arguments: JSON.stringify({
          log_source: 'logs/sessions/inspector-source.jsonl',
          analysis_depth: 'quick',
        }),
      },
    });

    assert.strictEqual(result.status, 'success');
    assert.deepEqual((result.artifact_manifest ?? []).map(item => item.path), [
      'logs/sessions/inspector-source.jsonl',
    ]);
    assert.ok(result.artifact_manifest?.every(item => item.action === 'captured'));
    assert.ok(result.artifact_manifest?.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(result.artifact_manifest?.every(item => item.metadata?.artifact_role === 'source_log'));
    assert.ok(!result.artifact_manifest?.some(item => item.metadata?.inferred === true));
  });

  test('reviewer-cat 角色通过组合层注册 Codex 和模块测试工具', () => {
    RoleResolver.activateRole('reviewer-cat');
    const manager = createRoleAwareToolManager();
    assert.ok(manager.getTool('reviewer_eval_prepare'));
    assert.ok(manager.getTool('reviewer_xiaoba_cli_e2e'));
    assert.ok(manager.getTool('codex_session_list'));
    assert.ok(manager.getTool('codex_job_start'));
    assert.ok(manager.getTool('codex_job_status'));
    assert.ok(manager.getTool('codex_job_resume'));
    assert.ok(manager.getTool('codex_job_cancel'));
    assert.ok(manager.getTool('reviewer_module_test'));
  });

  test('engineer-cat 角色通过组合层注册 Codex session 和 job 工具', () => {
    RoleResolver.activateRole('engineer-cat');
    const manager = createRoleAwareToolManager();
    assert.ok(manager.getTool('engineer_codex_supervisor_start'));
    assert.ok(manager.getTool('engineer_codex_supervisor_status'));
    assert.ok(manager.getTool('engineer_codex_supervisor_resume'));
    assert.ok(manager.getTool('engineer_codex_supervisor_cancel'));
    assert.ok(manager.getTool('engineer_task_run'));
    assert.ok(manager.getTool('engineer_task_status'));
    assert.ok(manager.getTool('engineer_task_resume'));
    assert.ok(manager.getTool('engineer_task_cancel'));
    assert.ok(manager.getTool('codex_session_list'));
    assert.ok(manager.getTool('codex_job_start'));
    assert.ok(manager.getTool('codex_job_status'));
    assert.ok(manager.getTool('codex_job_resume'));
    assert.ok(manager.getTool('codex_job_cancel'));
  });

  test('codex job tools 显式声明 job 状态和事件证据', () => {
    const context = { workingDirectory: testRoot, conversationHistory: [] };
    const expectedBase = 'data/codex-jobs/manifest-codex-job';

    const startManifest = new CodexJobStartTool().getArtifactManifest?.(
      { job_id: 'manifest-codex-job' },
      'codex: running=true status=running\njob_id=manifest-codex-job',
      context,
    ) ?? [];
    assert.deepEqual(startManifest.map(item => item.path), [
      `${expectedBase}/job.json`,
      `${expectedBase}/events.jsonl`,
      `${expectedBase}/stderr.log`,
    ]);
    assert.deepEqual(startManifest.map(item => item.action), ['created', 'captured', 'captured']);
    assert.ok(startManifest.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(startManifest.some(item => item.metadata?.artifact_role === 'job_state'));
    assert.ok(startManifest.some(item => item.metadata?.artifact_role === 'codex_events'));

    const statusManifest = new CodexJobStatusTool().getArtifactManifest?.(
      { job_id: 'manifest-codex-job' },
      'codex: running=true status=running\njob_id=manifest-codex-job',
      context,
    ) ?? [];
    assert.deepEqual(statusManifest.map(item => item.path), [
      `${expectedBase}/job.json`,
      `${expectedBase}/events.jsonl`,
      `${expectedBase}/stderr.log`,
    ]);
    assert.ok(statusManifest.every(item => item.action === 'captured'));

    const jobDir = path.join(testRoot, 'data', 'codex-jobs', 'manifest-codex-job');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'last-message.txt'), 'done\n', 'utf-8');
    const cancelManifest = new CodexJobCancelTool().getArtifactManifest?.(
      { job_id: 'manifest-codex-job' },
      'codex_job_cancel 已请求取消: job_id=manifest-codex-job, pid=123',
      context,
    ) ?? [];
    assert.deepEqual(cancelManifest.map(item => item.path), [
      `${expectedBase}/job.json`,
      `${expectedBase}/events.jsonl`,
      `${expectedBase}/stderr.log`,
      `${expectedBase}/last-message.txt`,
    ]);
    assert.strictEqual(cancelManifest.find(item => item.path.endsWith('job.json'))?.action, 'updated');
    assert.strictEqual(cancelManifest.find(item => item.path.endsWith('last-message.txt'))?.metadata?.artifact_role, 'last_message');

    const resumeManifest = new CodexJobResumeTool().getArtifactManifest?.(
      {},
      'codex: running=true status=running\njob_id=manifest-codex-resume\nsession=codex-session-1',
      context,
    ) ?? [];
    assert.deepEqual(resumeManifest.map(item => item.path), [
      'data/codex-jobs/manifest-codex-resume/job.json',
      'data/codex-jobs/manifest-codex-resume/events.jsonl',
      'data/codex-jobs/manifest-codex-resume/stderr.log',
    ]);
    assert.deepEqual(resumeManifest.map(item => item.action), ['created', 'captured', 'captured']);

    const errorManifest = new CodexJobStatusTool().getArtifactManifest?.(
      { job_id: 'missing-job' },
      '错误：找不到 Codex job: missing-job',
      context,
    ) ?? [];
    assert.deepEqual(errorManifest, []);
  });

  test('researcher alias 通过组合层注册 auto research 和 Research Board 工具', () => {
    RoleResolver.activateRole('researcher');
    const manager = createRoleAwareToolManager();
    assert.ok(manager.getTool('auto_research_run'));
    assert.ok(manager.getTool('research_board_update'));
    assert.ok(manager.getTool('research_board_read'));
  });

  test('guide alias 通过组合层注册 TPC baseline、eval analysis 和 env baseline 工具', () => {
    RoleResolver.activateRole('tpc-guide');
    const manager = createRoleAwareToolManager();
    assert.ok(manager.getTool('guide_tpc_baseline'));
    assert.ok(manager.getTool('guide_tpc_eval_analysis'));
    assert.ok(manager.getTool('guide_tpc_env_baseline'));
  });

  test('researcher role tools emit explicit tool-owned artifact manifests', async () => {
    RoleResolver.activateRole('researcher');
    const manager = createRoleAwareToolManager(testRoot);

    const boardResult = await manager.executeTool({
      id: 'research-board-explicit-1',
      type: 'function',
      function: {
        name: 'research_board_update',
        arguments: JSON.stringify({
          project: 'Manifest Demo',
          goal: 'prove explicit board artifact evidence',
          claim_board: [{ claim: 'Manifest evidence is explicit.', status: 'weakly_supported' }],
        }),
      },
    });

    assert.strictEqual(boardResult.status, 'success');
    assert.deepEqual((boardResult.artifact_manifest ?? []).map(item => item.path), [
      'data/researcher-cat/boards/manifest-demo/board.json',
      'output/researcher-cat/boards/manifest-demo/research-board.md',
      'data/researcher-cat/boards/manifest-demo/events.jsonl',
    ]);
    assert.ok(boardResult.artifact_manifest?.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(!boardResult.artifact_manifest?.some(item => item.metadata?.inferred === true));

    const autoResult = await manager.executeTool({
      id: 'auto-research-explicit-1',
      type: 'function',
      function: {
        name: 'auto_research_run',
        arguments: JSON.stringify({
          project: 'Manifest Auto',
          goal: 'prove explicit auto research artifact evidence',
          workspace_path: '.',
          max_files: 5,
        }),
      },
    });

    assert.strictEqual(autoResult.status, 'success');
    const autoPaths = (autoResult.artifact_manifest ?? []).map(item => item.path);
    assert.ok(autoPaths.includes('data/researcher-cat/auto-research/manifest-auto/intake-manifest.json'));
    assert.ok(autoPaths.includes('output/researcher-cat/auto-research/manifest-auto/auto-research-report.md'));
    assert.ok(autoPaths.includes('data/researcher-cat/auto-research/manifest-auto/phase-plan.json'));
    assert.ok(autoPaths.includes('data/researcher-cat/auto-research/manifest-auto/reviewer-handoff.json'));
    assert.ok(autoPaths.includes('data/researcher-cat/boards/manifest-auto/board.json'));
    assert.ok(autoResult.artifact_manifest?.some(item => item.path.endsWith('intake-manifest.json') && item.action === 'generated'));
    assert.ok(autoResult.artifact_manifest?.some(item => item.path.endsWith('board.json') && item.action === 'updated'));
    assert.ok(autoResult.artifact_manifest?.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(!autoResult.artifact_manifest?.some(item => item.metadata?.inferred === true));
  });

  test('role alias resolves base tool inheritance policy', () => {
    const manager = createRoleAwareToolManager(testRoot, {}, 'secretary');
    assert.ok(manager.getTool('skill'));
    assert.strictEqual(manager.getTool('execute_shell'), undefined);
    assert.strictEqual(manager.getTool('read_file'), undefined);
  });

  test('组合层把激活角色写入工具执行上下文', async () => {
    RoleResolver.activateRole('engineer-cat');
    const manager = createRoleAwareToolManager();
    manager.registerTool({
      definition: {
        name: 'context_probe',
        description: 'probe tool context',
        parameters: { type: 'object', properties: {} },
      },
      async execute(_args, context) {
        return context.roleName || '';
      },
    });

    const result = await manager.executeTool({
      id: 'context-probe-1',
      type: 'function',
      function: {
        name: 'context_probe',
        arguments: '{}',
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.content, 'engineer-cat');
  });

  test('engineer-cat 能按项目 cwd 查询 Codex sessions', async () => {
    RoleResolver.activateRole('engineer-cat');
    const codexHome = path.join(testRoot, '.codex-home');
    process.env.CODEX_HOME = codexHome;
    const projectRoot = path.join(testRoot, 'hermes-agent');
    const otherRoot = path.join(testRoot, 'other-project');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(otherRoot, { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026', '05', '12'), { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, 'session_index.jsonl'),
      [
        JSON.stringify({
          id: '019e1710-061e-7880-b71c-a5a960978989',
          thread_name: '了解 TDD',
          updated_at: '2026-05-11T12:43:13.68512Z',
        }),
        JSON.stringify({
          id: '019e0700-9388-7163-9c06-cfba0aa9ea31',
          thread_name: '其他项目',
          updated_at: '2026-05-08T09:52:41.924843Z',
        }),
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(codexHome, 'sessions', '2026', '05', '12', 'rollout-hermes.jsonl'),
      `${JSON.stringify({ type: 'session_meta', payload: { id: '019e1710-061e-7880-b71c-a5a960978989', cwd: projectRoot } })}\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(codexHome, 'sessions', '2026', '05', '12', 'rollout-other.jsonl'),
      `${JSON.stringify({ type: 'session_meta', payload: { id: '019e0700-9388-7163-9c06-cfba0aa9ea31', cwd: otherRoot } })}\n`,
      'utf-8',
    );

    const manager = createRoleAwareToolManager(projectRoot);
    const result = await manager.executeTool({
      id: 'codex-session-list-1',
      type: 'function',
      function: {
        name: 'codex_session_list',
        arguments: JSON.stringify({ cwd: projectRoot }),
      },
    });

    assert.strictEqual(result.ok, true);
    const payload = JSON.parse(String(result.content));
    assert.strictEqual(payload.count, 1);
    assert.strictEqual(payload.sessions[0].id, '019e1710-061e-7880-b71c-a5a960978989');
    assert.strictEqual(payload.sessions[0].thread, '了解 TDD');
  });

  test('reviewer-cat eval prepare 工具能通过 ToolManager 执行并落盘评估工件', async () => {
    RoleResolver.activateRole('reviewer-cat');
    fs.writeFileSync(
      path.join(testRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } }, null, 2),
      'utf-8',
    );

    const manager = createRoleAwareToolManager(testRoot);
    const result = await manager.executeTool({
      id: 'eval-prepare-1',
      type: 'function',
      function: {
        name: 'reviewer_eval_prepare',
        arguments: JSON.stringify({
          review_id: 'runtime-channel',
          request: 'Verify reviewer eval runtime channel.',
          changed_files: ['src/example.ts'],
        }),
      },
    });

    assert.strictEqual(result.ok, true);
    assert.match(String(result.content), /reviewer_eval_prepare: status=prepared/);
    assert.ok(fs.existsSync(path.join(testRoot, 'data', 'reviewer-runs', 'runtime-channel', 'review-eval-plan.md')));
    assert.ok(fs.existsSync(path.join(testRoot, 'data', 'reviewer-runs', 'runtime-channel', 'test-matrix.md')));
    assert.deepEqual((result.artifact_manifest ?? []).map(item => item.path), [
      'data/reviewer-runs/runtime-channel/task.json',
      'data/reviewer-runs/runtime-channel/evaluation-profile.md',
      'data/reviewer-runs/runtime-channel/evaluation-profile.json',
      'data/reviewer-runs/runtime-channel/review-eval-plan.md',
      'data/reviewer-runs/runtime-channel/boundary-map.md',
      'data/reviewer-runs/runtime-channel/test-matrix.md',
      'data/reviewer-runs/runtime-channel/summary.json',
    ]);
    assert.ok(result.artifact_manifest?.every(item => item.action === 'generated'));
    assert.ok(result.artifact_manifest?.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(!result.artifact_manifest?.some(item => item.metadata?.inferred === true));
  });

  test('reviewer-cat module test 工具显式声明 report 和 log 产物', async () => {
    RoleResolver.activateRole('reviewer-cat');
    const manager = createRoleAwareToolManager(testRoot);
    const result = await manager.executeTool({
      id: 'module-test-manifest-1',
      type: 'function',
      function: {
        name: 'reviewer_module_test',
        arguments: JSON.stringify({
          run_id: 'manifest-module',
          module: 'custom',
          tests: [
            { name: 'ok', command: 'node -e "console.log(42)"' },
          ],
        }),
      },
    });

    assert.strictEqual(result.ok, true);
    assert.match(String(result.content), /reviewer_module_test: status=passed/);
    assert.deepEqual((result.artifact_manifest ?? []).map(item => item.path), [
      'data/reviewer-module-tests/manifest-module/report.json',
      'data/reviewer-module-tests/manifest-module/01-ok.stdout.log',
      'data/reviewer-module-tests/manifest-module/01-ok.stderr.log',
    ]);
    assert.ok(result.artifact_manifest?.every(item => item.action === 'generated'));
    assert.ok(result.artifact_manifest?.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(!result.artifact_manifest?.some(item => item.metadata?.inferred === true));
  });

  test('engineer-cat task status 工具显式声明 task 和 plan 证据', async () => {
    RoleResolver.activateRole('engineer-cat');
    const taskDir = path.join(testRoot, 'data', 'engineer-tasks', 'manifest-task');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'plan.md'), '# Plan\n', 'utf-8');
    fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify({
      version: 1,
      taskId: 'manifest-task',
      status: 'running',
      route: 'codex_start',
      cwd: testRoot,
      request: 'prove engineer tool-owned artifacts',
      allowEdits: true,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
      validation: {
        status: 'not_configured',
        commands: [],
        source: 'not_configured',
        reasons: [],
        timeoutMs: 300000,
        results: [],
      },
      artifacts: {
        dir: taskDir,
        task: path.join(taskDir, 'task.json'),
        plan: path.join(taskDir, 'plan.md'),
        validation: path.join(taskDir, 'validation.md'),
        finalSummary: path.join(taskDir, 'final-summary.md'),
      },
    }, null, 2), 'utf-8');

    const manager = createRoleAwareToolManager(testRoot);
    const result = await manager.executeTool({
      id: 'engineer-task-status-manifest-1',
      type: 'function',
      function: {
        name: 'engineer_task_status',
        arguments: JSON.stringify({ task_id: 'manifest-task' }),
      },
    });

    assert.strictEqual(result.ok, true);
    assert.match(String(result.content), /engineer_task: running=true status=running/);
    assert.deepEqual((result.artifact_manifest ?? []).map(item => item.path), [
      'data/engineer-tasks/manifest-task/task.json',
      'data/engineer-tasks/manifest-task/plan.md',
    ]);
    assert.ok(result.artifact_manifest?.every(item => item.action === 'captured'));
    assert.ok(result.artifact_manifest?.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(!result.artifact_manifest?.some(item => item.metadata?.inferred === true));
  });

  test('role text tool outputs produce inferred artifact manifests', async () => {
    const manager = new ToolManager(testRoot);
    manager.registerTool({
      definition: {
        name: 'engineer_task_status',
        description: 'fake EngineerCat task status',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return [
          'engineer_task: running=false status=completed',
          `cwd=${path.join(testRoot, 'project')}`,
          'task_file=data/engineer-tasks/demo/task.json',
          'plan=data/engineer-tasks/demo/plan.md',
          'validation=data/engineer-tasks/demo/validation.md',
          'final_summary=data/engineer-tasks/demo/final-summary.md',
        ].join('\n');
      },
    });

    const result = await manager.executeTool({
      id: 'engineer-task-status-1',
      type: 'function',
      function: {
        name: 'engineer_task_status',
        arguments: '{}',
      },
    });

    assert.strictEqual(result.status, 'success');
    assert.deepEqual((result.artifact_manifest ?? []).map(item => item.path), [
      'data/engineer-tasks/demo/task.json',
      'data/engineer-tasks/demo/plan.md',
      'data/engineer-tasks/demo/validation.md',
      'data/engineer-tasks/demo/final-summary.md',
    ]);
    assert.ok(result.artifact_manifest?.every(item => item.action === 'captured'));
    assert.ok(result.artifact_manifest?.every(item => item.metadata?.inferred === true));
    assert.ok(!result.artifact_manifest?.some(item => item.path === path.join(testRoot, 'project')));
  });

  test('role JSON tool outputs produce inferred artifact manifests', async () => {
    const boardJson = path.join(testRoot, 'data', 'researcher-cat', 'boards', 'demo', 'board.json');
    const boardMarkdown = path.join(testRoot, 'output', 'researcher-cat', 'boards', 'demo', 'research-board.md');
    const eventsJsonl = path.join(testRoot, 'data', 'researcher-cat', 'boards', 'demo', 'events.jsonl');
    const manager = new ToolManager(testRoot);
    manager.registerTool({
      definition: {
        name: 'research_board_update',
        description: 'fake ResearcherCat board update',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return `${JSON.stringify({
          ok: true,
          board_json_path: boardJson,
          board_markdown_path: boardMarkdown,
          events_jsonl_path: eventsJsonl,
          status: 'completed',
        }, null, 2)}\n`;
      },
    });

    const result = await manager.executeTool({
      id: 'research-board-update-1',
      type: 'function',
      function: {
        name: 'research_board_update',
        arguments: '{}',
      },
    });

    assert.strictEqual(result.status, 'success');
    assert.deepEqual((result.artifact_manifest ?? []).map(item => item.path), [
      boardJson,
      boardMarkdown,
      eventsJsonl,
    ]);
    assert.deepEqual((result.artifact_manifest ?? []).map(item => item.type), [
      'json',
      'md',
      'jsonl',
    ]);
  });
});
