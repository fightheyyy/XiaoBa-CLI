import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CodexTaskAdapter,
  EngineerTaskRunOptions,
  EngineerTaskRunner,
} from '../src/roles/engineer-cat/utils/engineer-task-runner';
import {
  EngineerCodexSupervisor,
  readSupervisor,
} from '../src/roles/engineer-cat/utils/engineer-codex-supervisor';

const originalCwd = process.cwd();

class FakeCodexAdapter implements CodexTaskAdapter {
  starts: EngineerTaskRunOptions[] = [];
  resumes: Array<EngineerTaskRunOptions & { codexSessionId: string }> = [];
  statuses: string[] = [];
  cancels: string[] = [];
  private sessionsByJob = new Map<string, string>();

  async start(options: EngineerTaskRunOptions) {
    this.starts.push(options);
    const jobId = `job-${options.taskId || this.starts.length}`;
    const sessionId = `session-${options.taskId || this.starts.length}`;
    this.sessionsByJob.set(jobId, sessionId);
    return {
      jobId,
      sessionId,
      raw: `codex: running=true status=running\njob_id=${jobId}\nsession=${sessionId}`,
    };
  }

  async resume(options: EngineerTaskRunOptions & { codexSessionId: string }) {
    this.resumes.push(options);
    const jobId = `resume-${options.taskId || this.resumes.length}`;
    this.sessionsByJob.set(jobId, options.codexSessionId);
    return {
      jobId,
      sessionId: options.codexSessionId,
      raw: `codex: running=true status=running\njob_id=${jobId}\nsession=${options.codexSessionId}`,
    };
  }

  async status(options: { jobId: string }) {
    this.statuses.push(options.jobId);
    const sessionId = this.sessionsByJob.get(options.jobId) || `session-${options.jobId}`;
    return {
      status: 'completed',
      sessionId,
      lastMessage: `done ${options.jobId}`,
      raw: `codex: running=false status=completed\nsession=${sessionId}\noutput=done ${options.jobId}`,
    };
  }

  async cancel(jobId: string) {
    this.cancels.push(jobId);
    return `codex_job_cancel 已请求取消: job_id=${jobId}`;
  }
}

function validationCommand(label: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`console.log(${JSON.stringify(label)})`)}`;
}

describe('EngineerCodexSupervisor', () => {
  let testRoot: string;
  let fakeCodex: FakeCodexAdapter;
  let supervisor: EngineerCodexSupervisor;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-engineer-supervisor-'));
    process.chdir(testRoot);
    fakeCodex = new FakeCodexAdapter();
    supervisor = new EngineerCodexSupervisor(new EngineerTaskRunner(fakeCodex));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  test('enforces max_parallel and starts dependent Codex workers after prerequisites pass', async () => {
    const created = await supervisor.create({
      supervisorId: 'multi-session-smoke',
      goal: 'ship a multi-part EngineerCat change',
      cwd: testRoot,
      maxParallel: 1,
      workers: [
        {
          workerId: 'runtime',
          request: 'Implement runtime supervisor support.',
          validationCommands: [validationCommand('runtime-ok')],
          skipGitRepoCheck: true,
        },
        {
          workerId: 'eval',
          request: 'Add eval coverage after runtime is ready.',
          dependsOn: ['runtime'],
          validationCommands: [validationCommand('eval-ok')],
          skipGitRepoCheck: true,
        },
      ],
    });

    assert.strictEqual(created.status, 'running');
    assert.deepStrictEqual(created.workers.map(worker => worker.status), ['running', 'queued']);
    assert.strictEqual(fakeCodex.starts.length, 1);

    const afterRuntime = await supervisor.status({ supervisorId: 'multi-session-smoke' });
    assert.ok(afterRuntime);
    assert.deepStrictEqual(afterRuntime!.workers.map(worker => worker.status), ['completed', 'running']);
    assert.strictEqual(fakeCodex.starts.length, 2);

    const completed = await supervisor.status({ supervisorId: 'multi-session-smoke' });
    assert.ok(completed);
    assert.strictEqual(completed!.status, 'completed');
    assert.deepStrictEqual(completed!.workers.map(worker => worker.status), ['completed', 'completed']);
    assert.ok(fs.existsSync(completed!.artifacts.aggregate));
    const aggregate = fs.readFileSync(completed!.artifacts.aggregate, 'utf-8');
    assert.match(aggregate, /workers_total: 2/);
    assert.match(aggregate, /runtime - completed/);
    assert.match(aggregate, /eval - completed/);
    assert.strictEqual(readSupervisor('multi-session-smoke')?.status, 'completed');
  });

  test('resumes and cancels individual workers without losing supervisor evidence', async () => {
    await supervisor.create({
      supervisorId: 'resume-cancel-smoke',
      goal: 'exercise worker resume and cancellation',
      cwd: testRoot,
      maxParallel: 1,
      workers: [
        {
          workerId: 'worker-a',
          request: 'Do the first part.',
          validationCommands: [validationCommand('worker-a-ok')],
          skipGitRepoCheck: true,
        },
      ],
    });
    await supervisor.status({ supervisorId: 'resume-cancel-smoke' });

    const resumed = await supervisor.resume({
      supervisorId: 'resume-cancel-smoke',
      workerId: 'worker-a',
      feedback: 'Validation review found one more edge case; continue same session.',
      skipGitRepoCheck: true,
    });
    assert.ok(resumed);
    assert.strictEqual(resumed!.workers[0].status, 'running');
    assert.strictEqual(fakeCodex.resumes.length, 1);
    assert.strictEqual(fakeCodex.resumes[0].codexSessionId, 'session-resume-cancel-smoke-worker-a');

    const cancelled = await supervisor.cancel({
      supervisorId: 'resume-cancel-smoke',
      workerId: 'worker-a',
    });
    assert.ok(cancelled);
    assert.strictEqual(cancelled!.workers[0].status, 'cancelled');
    assert.ok(fakeCodex.cancels.includes('resume-resume-cancel-smoke-worker-a'));
    assert.ok(fs.existsSync(cancelled!.artifacts.aggregate));
  });

  test('blocks workers with missing dependencies instead of leaving them queued forever', async () => {
    const created = await supervisor.create({
      supervisorId: 'missing-dependency-smoke',
      goal: 'prove dependency guardrails',
      cwd: testRoot,
      maxParallel: 1,
      workers: [
        {
          workerId: 'docs',
          request: 'Write docs only after runtime exists.',
          dependsOn: ['runtime'],
          validationCommands: [validationCommand('docs-ok')],
          skipGitRepoCheck: true,
        },
      ],
    });

    assert.strictEqual(created.status, 'blocked');
    assert.strictEqual(created.workers[0].status, 'blocked');
    assert.match(created.workers[0].error || '', /Dependency runtime was not found/);
    assert.strictEqual(fakeCodex.starts.length, 0);
    const aggregate = fs.readFileSync(created.artifacts.aggregate, 'utf-8');
    assert.match(aggregate, /docs - blocked/);
    assert.match(aggregate, /Dependency runtime was not found/);
  });

  test('refuses resume when the worker is still running or max_parallel is full', async () => {
    await supervisor.create({
      supervisorId: 'resume-guard-smoke',
      goal: 'guard unsafe worker resume',
      cwd: testRoot,
      maxParallel: 1,
      workers: [
        {
          workerId: 'runtime',
          request: 'Implement runtime first.',
          validationCommands: [validationCommand('runtime-ok')],
          skipGitRepoCheck: true,
        },
        {
          workerId: 'eval',
          request: 'Implement eval second.',
          validationCommands: [validationCommand('eval-ok')],
          skipGitRepoCheck: true,
        },
      ],
    });

    await assert.rejects(
      () => supervisor.resume({
        supervisorId: 'resume-guard-smoke',
        workerId: 'runtime',
        feedback: 'Try to resume while runtime is still running.',
        skipGitRepoCheck: true,
      }),
      /仍在 running/,
    );

    const afterRuntime = await supervisor.status({ supervisorId: 'resume-guard-smoke' });
    assert.ok(afterRuntime);
    assert.deepStrictEqual(afterRuntime!.workers.map(worker => worker.status), ['completed', 'running']);

    await assert.rejects(
      () => supervisor.resume({
        supervisorId: 'resume-guard-smoke',
        workerId: 'runtime',
        feedback: 'Try to resume runtime while eval occupies the only worker slot.',
        skipGitRepoCheck: true,
      }),
      /max_parallel=1 已满/,
    );
    assert.strictEqual(fakeCodex.resumes.length, 0);
  });
});
