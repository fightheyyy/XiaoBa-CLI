import { after, afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRoleAwareToolManager } from '../src/bootstrap/tool-manager';
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
  });
});
