import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  CodexTaskAdapter,
  EngineerTaskRunOptions,
  EngineerTaskRunner,
  readTask,
} from '../src/roles/engineer-cat/utils/engineer-task-runner';
import {
  planChangedFileValidation,
} from '../src/roles/engineer-cat/utils/engineer-quality-gates';

const originalCwd = process.cwd();

class FakeCodexAdapter implements CodexTaskAdapter {
  starts: EngineerTaskRunOptions[] = [];
  resumes: Array<EngineerTaskRunOptions & { codexSessionId: string }> = [];
  cancels: string[] = [];
  statusValue = {
    status: 'completed',
    sessionId: 'codex-session-1',
    lastMessage: 'done from codex',
    raw: 'codex: running=false status=completed\nsession=codex-session-1\noutput=done from codex',
  };

  async start(options: EngineerTaskRunOptions) {
    this.starts.push(options);
    return {
      jobId: 'codex-job-1',
      sessionId: 'codex-session-1',
      raw: 'codex: running=true status=running\njob_id=codex-job-1\nsession=codex-session-1',
    };
  }

  async resume(options: EngineerTaskRunOptions & { codexSessionId: string }) {
    this.resumes.push(options);
    return {
      jobId: 'codex-job-2',
      sessionId: options.codexSessionId,
      raw: `codex: running=true status=running\njob_id=codex-job-2\nsession=${options.codexSessionId}`,
    };
  }

  async status() {
    return this.statusValue;
  }

  async cancel(jobId: string) {
    this.cancels.push(jobId);
    return `codex_job_cancel 已请求取消: job_id=${jobId}`;
  }
}

describe('EngineerTaskRunner', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-engineer-task-'));
    process.chdir(testRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  test('creates a trackable task and starts Codex in the requested cwd', async () => {
    const projectRoot = path.join(testRoot, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);

    const task = await runner.run({
      request: '帮我维护 XiaoBa-CLI 的 engineer 能力',
      taskId: 'morning-work',
      cwd: projectRoot,
      allowEdits: true,
      skipGitRepoCheck: true,
    });

    assert.strictEqual(task.status, 'running');
    assert.strictEqual(task.codexJobId, 'codex-job-1');
    assert.strictEqual(task.codexSessionId, 'codex-session-1');
    assert.strictEqual(fakeCodex.starts[0].cwd, projectRoot);
    assert.ok(fs.existsSync(path.join(testRoot, 'data', 'engineer-tasks', 'morning-work', 'task.json')));
    assert.ok(fs.existsSync(path.join(testRoot, 'data', 'engineer-tasks', 'morning-work', 'plan.md')));
  });

  test('syncs Codex completion into final summary and can resume the same session', async () => {
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);
    await runner.run({
      request: '实现一个小需求',
      taskId: 'resume-me',
      cwd: testRoot,
      allowEdits: true,
      skipGitRepoCheck: true,
    });

    const status = await runner.status({
      taskId: 'resume-me',
      waitMs: 0,
      pollIntervalMs: 5000,
      verbose: false,
    });
    assert.match(status, /status=completed/);
    const completed = readTask('resume-me');
    assert.strictEqual(completed?.status, 'completed');
    assert.ok(completed?.artifacts.finalSummary && fs.existsSync(completed.artifacts.finalSummary));

    const resumed = await runner.resume({
      taskId: 'resume-me',
      feedback: '测试失败了，请继续修',
      request: '测试失败了，请继续修',
      cwd: testRoot,
      allowEdits: true,
      skipGitRepoCheck: true,
    });
    assert.match(resumed, /codex_job_id=codex-job-2/);
    assert.strictEqual(fakeCodex.resumes[0].codexSessionId, 'codex-session-1');
    assert.strictEqual(readTask('resume-me')?.status, 'running');
  });

  test('runs validation commands after Codex completion and records evidence', async () => {
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);
    const passCommand = `${JSON.stringify(process.execPath)} -e "console.log('validation-ok')"`;
    await runner.run({
      request: '实现一个需要验证的小需求',
      taskId: 'validate-me',
      cwd: testRoot,
      allowEdits: true,
      validationCommands: [passCommand],
      validationTimeoutMs: 30_000,
      skipGitRepoCheck: true,
    });

    const status = await runner.status({
      taskId: 'validate-me',
      waitMs: 0,
      pollIntervalMs: 5000,
      verbose: false,
    });

    assert.match(status, /status=completed/);
    assert.match(status, /validation_status=passed/);
    const completed = readTask('validate-me');
    assert.strictEqual(completed?.status, 'completed');
    assert.strictEqual(completed?.validation?.status, 'passed');
    assert.ok(completed?.artifacts.validation && fs.existsSync(completed.artifacts.validation));
    assert.match(fs.readFileSync(completed!.artifacts.validation, 'utf-8'), /validation-ok/);
  });

  test('infers Node validation gates when validation_commands are omitted', async () => {
    fs.writeFileSync(
      path.join(testRoot, 'package.json'),
      JSON.stringify({
        name: 'xiaoba-cli',
        scripts: {
          build: `${JSON.stringify(process.execPath)} -e "console.log('inferred-build-ok')"`,
          test: `${JSON.stringify(process.execPath)} -e "console.log('inferred-test-ok')"`,
        },
      }, null, 2),
      'utf-8',
    );
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);
    await runner.run({
      request: '维护 engineer-cat 的 Feishu Codex 链路',
      taskId: 'infer-validation',
      cwd: testRoot,
      allowEdits: true,
      validationTimeoutMs: 30_000,
      skipGitRepoCheck: true,
    });

    const task = readTask('infer-validation');
    assert.strictEqual(task?.validation?.source, 'inferred');
    assert.deepStrictEqual(task?.validation?.commands, ['npm run build', 'npm run test']);
    assert.match(fs.readFileSync(task!.artifacts.plan, 'utf-8'), /validation_source: inferred/);

    const status = await runner.status({
      taskId: 'infer-validation',
      waitMs: 0,
      pollIntervalMs: 5000,
      verbose: false,
    });

    assert.match(status, /validation_status=passed/);
    const completed = readTask('infer-validation');
    assert.strictEqual(completed?.validation?.status, 'passed');
    const validation = fs.readFileSync(completed!.artifacts.validation, 'utf-8');
    assert.match(validation, /source: inferred/);
    assert.match(validation, /inferred-build-ok/);
    assert.match(validation, /inferred-test-ok/);
  });

  test('does not infer validation gates for read-only tasks without explicit commands', async () => {
    fs.writeFileSync(
      path.join(testRoot, 'package.json'),
      JSON.stringify({
        scripts: {
          build: `${JSON.stringify(process.execPath)} -e "console.log('should-not-run')"`,
        },
      }, null, 2),
      'utf-8',
    );
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);
    await runner.run({
      request: '只读检查一下项目',
      taskId: 'read-only-no-infer',
      cwd: testRoot,
      allowEdits: false,
      skipGitRepoCheck: true,
    });

    const task = readTask('read-only-no-infer');
    assert.strictEqual(task?.validation?.source, 'not_configured');
    assert.deepStrictEqual(task?.validation?.commands, []);
  });

  test('adds a git diff check when Codex leaves changed files', async () => {
    execFileSync('git', ['init'], { cwd: testRoot, stdio: 'ignore' });
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testRoot, 'src', 'example.ts'), 'export const value = 1;\n', 'utf-8');
    execFileSync('git', ['add', 'src/example.ts'], { cwd: testRoot, stdio: 'ignore' });
    fs.writeFileSync(path.join(testRoot, 'src', 'example.ts'), 'export const value = 2;\n', 'utf-8');
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);
    await runner.run({
      request: '实现一个没有 package.json 的小修复',
      taskId: 'diff-check',
      cwd: testRoot,
      allowEdits: true,
      validationTimeoutMs: 30_000,
      skipGitRepoCheck: true,
    });

    const status = await runner.status({
      taskId: 'diff-check',
      waitMs: 0,
      pollIntervalMs: 5000,
      verbose: false,
    });

    assert.match(status, /validation_status=passed/);
    assert.match(status, /validation_source=inferred/);
    const completed = readTask('diff-check');
    assert.strictEqual(completed?.validation?.source, 'inferred');
    assert.deepStrictEqual(completed?.validation?.commands, ['git diff --check && git diff --cached --check']);
    assert.match(fs.readFileSync(completed!.artifacts.validation, 'utf-8'), /Detected 1 changed file/);
  });

  test('plans changed-file-aware EngineerCat gates for XiaoBa role changes', () => {
    fs.writeFileSync(
      path.join(testRoot, 'package.json'),
      JSON.stringify({ name: 'xiaoba-cli', scripts: {} }, null, 2),
      'utf-8',
    );
    fs.mkdirSync(path.join(testRoot, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'eval', 'suites'), { recursive: true });
    for (const file of [
      'test/engineer-task-runner.test.ts',
      'test/engineer-codex-supervisor.test.ts',
      'test/engineer-cat-codex-runner.test.ts',
      'test/tool-manager-roles.test.ts',
    ]) {
      fs.mkdirSync(path.dirname(path.join(testRoot, file)), { recursive: true });
      fs.writeFileSync(path.join(testRoot, file), '', 'utf-8');
    }

    const plan = planChangedFileValidation({
      cwd: testRoot,
      changedFiles: [
        'roles/engineer-cat/prompts/engineer-system-prompt.md',
        'src/roles/engineer-cat/utils/engineer-task-runner.ts',
      ],
      existingCommands: [],
    });

    assert.strictEqual(plan.source, 'inferred');
    assert.deepStrictEqual(plan.commands, [
      'node --test -r tsx test/engineer-task-runner.test.ts test/engineer-codex-supervisor.test.ts test/engineer-cat-codex-runner.test.ts test/tool-manager-roles.test.ts',
    ]);
    assert.match(plan.reasons.join('\n'), /EngineerCat role\/runtime files changed/);
  });

  test('failed validation prevents a task from masquerading as completed', async () => {
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);
    const failCommand = `${JSON.stringify(process.execPath)} -e "console.error('validation-failed'); process.exit(2)"`;
    await runner.run({
      request: '实现一个验证失败的小需求',
      taskId: 'validate-fails',
      cwd: testRoot,
      allowEdits: true,
      validationCommands: [failCommand],
      validationTimeoutMs: 30_000,
      skipGitRepoCheck: true,
    });

    const status = await runner.status({
      taskId: 'validate-fails',
      waitMs: 0,
      pollIntervalMs: 5000,
      verbose: false,
    });

    assert.match(status, /status=failed/);
    assert.match(status, /validation_status=failed/);
    const failed = readTask('validate-fails');
    assert.strictEqual(failed?.status, 'failed');
    assert.strictEqual(failed?.validation?.status, 'failed');
    assert.strictEqual(failed?.error, 'validation_failed');
    assert.ok(failed?.artifacts.finalSummary && fs.existsSync(failed.artifacts.finalSummary));
    assert.match(fs.readFileSync(failed!.artifacts.validation, 'utf-8'), /validation-failed/);
  });

  test('cancels the underlying Codex job', async () => {
    const fakeCodex = new FakeCodexAdapter();
    const runner = new EngineerTaskRunner(fakeCodex);
    await runner.run({
      request: '跑一个会被取消的任务',
      taskId: 'cancel-me',
      cwd: testRoot,
      allowEdits: true,
      skipGitRepoCheck: true,
    });

    const result = await runner.cancel('cancel-me');
    assert.match(result, /engineer_task_cancel/);
    assert.deepStrictEqual(fakeCodex.cancels, ['codex-job-1']);
    assert.strictEqual(readTask('cancel-me')?.status, 'cancelled');
  });
});
