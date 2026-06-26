import { describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CodexJobResumeTool,
  CodexJobStartTool,
  CodexJobStatusTool,
} from '../src/roles/reviewer-cat/tools/codex-job-tools';
import type { ToolExecutionContext } from '../src/types/tool';

const JOB_ROOT = path.resolve('data', 'codex-jobs');

describe('Codex job observability trace continuity', () => {
  test('resume jobs inherit parent job trace context without exporting raw traceparent in status', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-codex-job-trace-'));
    const jobSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const parentJobId = `trace-parent-${jobSuffix}`;
    const resumeJobId = `trace-resume-${jobSuffix}`;
    const capturePath = path.join(tempDir, 'traceparent.log');
    const parentTraceparent = '00-11111111111111111111111111111111-2222222222222222-01';
    const currentTraceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const previousPath = process.env.PATH;
    const previousCapture = process.env.CODEX_TRACE_CAPTURE;

    cleanupJob(parentJobId);
    cleanupJob(resumeJobId);

    try {
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const fakeCodexPath = path.join(binDir, 'codex');
      fs.writeFileSync(fakeCodexPath, fakeCodexScript(), 'utf-8');
      fs.chmodSync(fakeCodexPath, 0o755);
      process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
      process.env.CODEX_TRACE_CAPTURE = capturePath;

      const startTool = new CodexJobStartTool();
      const resumeTool = new CodexJobResumeTool();
      const statusTool = new CodexJobStatusTool();
      const baseContext: ToolExecutionContext = {
        workingDirectory: process.cwd(),
        conversationHistory: [],
        observabilityContext: {
          traceId: '11111111111111111111111111111111',
          spanId: '2222222222222222',
          traceFlags: 1,
          traceparent: parentTraceparent,
        },
      };

      const startOutput = await startTool.execute({
        message: 'start background work',
        job_id: parentJobId,
        cwd: process.cwd(),
        timeout_ms: 5000,
        skip_git_repo_check: true,
      }, baseContext);
      assert.match(String(startOutput), new RegExp(`job_id=${parentJobId}`));

      await statusTool.execute({
        job_id: parentJobId,
        wait_ms: 2000,
        poll_interval_ms: 50,
        verbose: true,
        include_git_status: false,
        max_chars: 100000,
      }, baseContext);
      const parentJob = readJob(parentJobId);
      assert.equal(parentJob.traceparent, parentTraceparent);
      assert.equal(parentJob.traceparentSource, 'current_context');
      assert.equal(parentJob.codexSessionId, 'fake-codex-session');

      const resumeContext: ToolExecutionContext = {
        workingDirectory: process.cwd(),
        conversationHistory: [],
        observabilityContext: {
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          spanId: 'bbbbbbbbbbbbbbbb',
          traceFlags: 1,
          traceparent: currentTraceparent,
        },
      };
      const resumeOutput = await resumeTool.execute({
        message: 'continue background work',
        job_id: resumeJobId,
        parent_job_id: parentJobId,
        timeout_ms: 5000,
        skip_git_repo_check: true,
      }, resumeContext);
      assert.match(String(resumeOutput), new RegExp(`job_id=${resumeJobId}`));

      const verboseStatus = String(await statusTool.execute({
        job_id: resumeJobId,
        wait_ms: 2000,
        poll_interval_ms: 50,
        verbose: true,
        include_git_status: false,
        max_chars: 100000,
      }, resumeContext));
      const compactStatus = String(await statusTool.execute({
        job_id: resumeJobId,
        include_git_status: false,
      }, resumeContext));
      const resumeJob = readJob(resumeJobId);
      const parsedStatus = JSON.parse(verboseStatus);
      const capturedTraceparents = fs.readFileSync(capturePath, 'utf-8').trim().split('\n');

      assert.equal(resumeJob.traceparent, parentTraceparent);
      assert.equal(resumeJob.traceparentSource, 'parent_job');
      assert.equal(parsedStatus.trace_context.propagated, true);
      assert.equal(parsedStatus.trace_context.source, 'parent_job');
      assert.equal(parsedStatus.trace_context.parent_job_linked, true);
      assert.equal(parsedStatus.trace_context.raw_traceparent_exported, false);
      assert.match(compactStatus, /trace_context=propagated/);
      assert.match(compactStatus, /trace_context_source=parent_job/);
      assert.deepEqual(capturedTraceparents, [parentTraceparent, parentTraceparent]);
      assert.doesNotMatch(verboseStatus, new RegExp(parentTraceparent));
      assert.doesNotMatch(verboseStatus, new RegExp(currentTraceparent));
      assert.doesNotMatch(compactStatus, new RegExp(parentTraceparent));
      assert.doesNotMatch(compactStatus, new RegExp(currentTraceparent));
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      if (previousCapture === undefined) {
        delete process.env.CODEX_TRACE_CAPTURE;
      } else {
        process.env.CODEX_TRACE_CAPTURE = previousCapture;
      }
      cleanupJob(parentJobId);
      cleanupJob(resumeJobId);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function fakeCodexScript(): string {
  return `#!/bin/sh
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
if [ -n "$CODEX_TRACE_CAPTURE" ]; then
  printf '%s\\n' "$TRACEPARENT" >> "$CODEX_TRACE_CAPTURE"
fi
if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  printf 'fake codex done\\n' > "$out"
fi
cat >/dev/null
printf '%s\\n' '{"type":"session","id":"fake-codex-session"}'
`;
}

function readJob(jobId: string): any {
  return JSON.parse(fs.readFileSync(path.join(JOB_ROOT, jobId, 'job.json'), 'utf-8'));
}

function cleanupJob(jobId: string): void {
  fs.rmSync(path.join(JOB_ROOT, jobId), { recursive: true, force: true });
}
