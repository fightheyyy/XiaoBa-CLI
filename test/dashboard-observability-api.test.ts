import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createApiRouter } from '../src/dashboard/routes/api';
import { ServiceManager } from '../src/dashboard/service-manager';
import { Observability, resetObservabilityForTests } from '../src/observability';
import { MessageSessionManager } from '../src/core/message-session-manager';

const originalCwd = process.cwd();

function seedObservability(includePrivatePreview: boolean, includeRepresentativeTrace = false): void {
  const observability = Observability.fromEnv({} as NodeJS.ProcessEnv);
  observability.recordMetric('xiaoba.tool.result', 1, {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.skill.name': 'case-implementation',
    'xiaoba.surface': 'dashboard',
    'xiaoba.tool.name': 'edit_file',
    'xiaoba.tool.status': 'success',
    ...(includePrivatePreview
      ? { 'xiaoba.tool.arguments.preview': '/Users/guowei/project token=secret-token-1234567890' }
      : {}),
  });
  observability.recordMetric('xiaoba.tool.duration_ms', 42, {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.skill.name': 'case-implementation',
    'xiaoba.surface': 'dashboard',
    'xiaoba.tool.name': 'edit_file',
    'xiaoba.tool.status': 'success',
  }, 'ms');
  observability.recordMetric('xiaoba.model.duration_ms', 128, {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.skill.name': 'case-implementation',
    'xiaoba.surface': 'dashboard',
    'xiaoba.provider.name': 'openai',
    'xiaoba.model.name': 'gpt-test',
    'xiaoba.model.status': 'success',
  }, 'ms');
  observability.recordMetric('xiaoba.model.call', 1, {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.skill.name': 'case-implementation',
    'xiaoba.surface': 'dashboard',
    'xiaoba.provider.name': 'openai',
    'xiaoba.model.name': 'gpt-test',
    'xiaoba.model.status': 'success',
  });
  observability.recordMetric('xiaoba.session.duration_ms', 310, {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.skill.name': 'case-implementation',
    'xiaoba.surface': 'dashboard',
    'xiaoba.session.status': 'blocked',
  }, 'ms');
  observability.recordMetric('xiaoba.tool.result', 1, {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.skill.name': 'case-implementation',
    'xiaoba.surface': 'dashboard',
    'xiaoba.tool.name': 'execute_shell',
    'xiaoba.tool.status': 'blocked',
    'xiaoba.error_code': 'COMMAND_DENIED',
    'xiaoba.blocked_reason': includePrivatePreview
      ? 'requires_approval: cat /Users/guowei/private.txt token=secret-token-1234567890'
      : 'requires_approval',
    ...(includePrivatePreview
      ? { 'xiaoba.tool.arguments.preview': '{"cmd":"cat /Users/guowei/private.txt"}' }
      : {}),
  });
  const sessionSpan = observability.startSpan('xiaoba.session', {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.surface': 'dashboard',
    ...(includePrivatePreview
      ? { 'xiaoba.user_input.preview': '/Users/guowei/private prompt token=secret-token-1234567890' }
      : {}),
  });
  const toolSpan = observability.startSpan('xiaoba.tool.call', {
    'xiaoba.role.name': 'engineer-cat',
    'xiaoba.surface': 'dashboard',
    'xiaoba.tool.name': 'execute_shell',
    ...(includePrivatePreview
      ? { 'xiaoba.tool.arguments.preview': '{"cmd":"cat /Users/guowei/private.txt"}' }
      : {}),
  }, sessionSpan.context);
  observability.endSpan(toolSpan, {
    status: 'error',
    attributes: {
      'xiaoba.tool.status': 'blocked',
      'xiaoba.error_code': 'COMMAND_DENIED',
    },
  });
  observability.endSpan(sessionSpan, {
    status: 'error',
    attributes: {
      'xiaoba.session.status': 'blocked',
      'xiaoba.error_code': 'COMMAND_DENIED',
    },
  });
  if (includeRepresentativeTrace) {
    const representativeSession = observability.startSpan('xiaoba.session', {
      'xiaoba.role.name': 'reviewer-cat',
      'xiaoba.surface': 'dashboard',
      'xiaoba.trace.parent_propagated': true,
    });
    const surfaceSpan = observability.startSpan('xiaoba.surface.ingress', {
      'xiaoba.surface': 'dashboard',
      'xiaoba.trace.parent_propagated': true,
    }, representativeSession.context);
    observability.endSpan(surfaceSpan, { status: 'ok' });
    const subagentTool = observability.startSpan('xiaoba.tool.call', {
      'xiaoba.tool.name': 'spawn_subagent',
      'xiaoba.subagent.role': 'reviewer-cat',
      'xiaoba.trace.parent_propagated': true,
    }, representativeSession.context);
    const subagentSession = observability.startSpan('xiaoba.subagent.session', {
      'xiaoba.subagent.role': 'reviewer-cat',
      'xiaoba.surface': 'agent',
      'xiaoba.trace.parent_propagated': true,
    }, subagentTool.context);
    const jobStart = observability.startSpan('xiaoba.codex_job.start', {
      'xiaoba.job.kind': 'codex',
      'xiaoba.job.operation': 'start',
      'xiaoba.trace.cross_process': true,
    }, subagentSession.context);
    const jobResume = observability.startSpan('xiaoba.codex_job.resume', {
      'xiaoba.job.kind': 'codex',
      'xiaoba.job.operation': 'resume',
      'xiaoba.trace.cross_process': true,
      'xiaoba.trace.parent_source': 'job_state',
    }, jobStart.context);
    observability.endSpan(jobResume, { status: 'ok' });
    observability.endSpan(jobStart, { status: 'ok' });
    observability.endSpan(subagentSession, { status: 'ok' });
    observability.endSpan(subagentTool, { status: 'ok' });
    observability.endSpan(representativeSession, { status: 'ok' });
  }
  resetObservabilityForTests(observability);
}

async function listen(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server: http.Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
}

describe('Dashboard observability API', () => {
  let testRoot = '';
  let actionOutputRoot = '';
  let server: http.Server | null = null;
  let baseUrl = '';
  let contractSentinelBefore = '';

  beforeEach(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-dashboard-observability-'));
    actionOutputRoot = path.join(testRoot, 'observability-output');
    contractSentinelBefore = fs.readFileSync(path.join(originalCwd, 'test', 'contract-smoke', 'suites', 'contract-sentinel.json'), 'utf-8');
    process.chdir(testRoot);
    seedObservability(true);

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', createApiRouter(new ServiceManager(testRoot), {
      observabilityRootDir: originalCwd,
      observabilityOutputRoot: actionOutputRoot,
    }));
    const listening = await listen(app);
    server = listening.server;
    baseUrl = listening.baseUrl;
  });

  afterEach(async () => {
    await closeServer(server);
    server = null;
    await MessageSessionManager.getManager('pet')?.destroy();
    resetObservabilityForTests(undefined);
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('returns redacted local-only SLO summary', async () => {
    const response = await fetch(`${baseUrl}/api/observability/summary`);
    assert.strictEqual(response.status, 200);
    const summary = await response.json() as any;

    assert.strictEqual(summary.external.enabled, false);
    assert.strictEqual(summary.local.enabled, true);
    assert.strictEqual(summary.totals.toolResults, 2);
    assert.strictEqual(summary.slo.toolSuccessRate, 0.5);
    assert.strictEqual(summary.latency.tool.p95Ms, 42);
    assert.strictEqual(summary.top.roles[0].name, 'engineer-cat');
    assert.strictEqual(summary.drilldown.recentErrors[0].attributes['xiaoba.error_code'], 'COMMAND_DENIED');
    assert.match(summary.drilldown.blockedReasons[0].name, /^requires_approval:/);
    assert.match(summary.drilldown.blockedReasons[0].name, /<redacted-path>/);
    assert.match(summary.drilldown.blockedReasons[0].name, /<redacted-secret>/);
    assert.match(summary.drilldown.recentErrors[0].attributes['xiaoba.blocked_reason'], /<redacted-path>/);
    assert.match(summary.drilldown.recentErrors[0].attributes['xiaoba.blocked_reason'], /<redacted-secret>/);
    assert.deepStrictEqual(summary.drilldown.policyDecisions, []);
    assert.strictEqual(summary.traces.rawTraceparentExported, false);
    assert.strictEqual(summary.traces.spanCount, 2);
    assert.strictEqual(summary.traces.recent[0].status, 'error');
    assert.strictEqual(summary.traces.recent[0].spans[0].attributes['xiaoba.role.name'], 'engineer-cat');
    assert.match(summary.traces.recent[0].traceIdHash, /^[0-9a-f]{16}$/);
    assert.strictEqual(summary.recent[0].attributes['xiaoba.tool.arguments.preview'], undefined);
    assert.strictEqual(summary.drilldown.recentErrors[0].attributes['xiaoba.tool.arguments.preview'], undefined);
    assert.strictEqual(summary.traces.recent[0].spans[0].attributes['xiaoba.user_input.preview'], undefined);

    const serialized = JSON.stringify(summary);
    assert.doesNotMatch(serialized, /guowei/);
    assert.doesNotMatch(serialized, /secret-token-1234567890/);
    assert.doesNotMatch(serialized, /\/Users\/guowei/);
    assert.doesNotMatch(serialized, /private\.txt/);
    assert.doesNotMatch(serialized, /arguments\.preview/);
    assert.doesNotMatch(serialized, /user_input\.preview/);
  });

  test('returns readonly observability review state without generation actions', async () => {
    seedObservability(false, true);

    const state = await getJson('/api/observability/review');
    assert.strictEqual(state.actions.can_generate, false);
    assert.deepStrictEqual(state.artifacts, {});
    assert.strictEqual(state.summary.candidate_count, 0);
    assert.strictEqual(state.summary.trace_continuity_ready, false);
    assert.strictEqual(state.summary.auto_accepted_benchmark, false);
    assert.strictEqual(
      fs.readFileSync(path.join(originalCwd, 'test', 'contract-smoke', 'suites', 'contract-sentinel.json'), 'utf-8'),
      contractSentinelBefore,
    );
    assert.doesNotMatch(JSON.stringify(state), /\/Users\/guowei/);
  });

  test('navigation accepts maintained pages and rejects retired workspace page', async () => {
    const petResponse = await fetch(`${baseUrl}/api/navigation/open?page=pet`);
    assert.strictEqual(petResponse.status, 200);

    const arenaResponse = await fetch(`${baseUrl}/api/navigation/open?page=arena`);
    assert.strictEqual(arenaResponse.status, 200);

    const retiredResponse = await fetch(`${baseUrl}/api/navigation/open?page=room`);
    assert.strictEqual(retiredResponse.status, 400);
    const body = await retiredResponse.json() as { error?: string };
    assert.strictEqual(body.error, 'Invalid dashboard page');
  });

  test('returns Arena subject and run summary without raw local paths', async () => {
    const subjectDir = path.join(testRoot, 'arena', 'subjects', 'skill-gsap');
    const runDir = path.join(testRoot, 'arena', 'runs', 'gsap-pass');
    fs.mkdirSync(subjectDir, { recursive: true });
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(subjectDir, 'arena-manifest.json'), JSON.stringify({
      version: 1,
      subject_id: 'skill-gsap',
      subject: {
        type: 'skill',
        name: 'gsap-core',
        description: 'GSAP animation skill review target',
        capabilities: ['timeline'],
        required_tools: ['read_file'],
      },
      source: {
        type: 'github',
        owner: 'greensock',
        repo: 'gsap-skills',
      },
      parsed: {
        docs: ['SKILL.md'],
        prompt_files: [],
        skill_files: ['SKILL.md'],
        declared_tools: [],
      },
      safety: {
        risk_level: 'low',
        warnings: [],
      },
      trust_level: 'review_required',
      allowed_runtime: 'arena_only',
      default_sandbox: {
        mode: 'read_only',
        network: 'disabled',
        env_allowlist: [],
        timeout_ms: 120000,
      },
      fingerprint: 'abc',
      created_at: '2026-06-30T01:00:00.000Z',
    }));
    fs.writeFileSync(path.join(runDir, 'clean-runtime.json'), JSON.stringify({
      version: 1,
      run_id: 'gsap-pass',
      review_mode: 'base_skill',
      subject_id: 'skill-gsap',
      subject_manifest_path: 'arena/subjects/skill-gsap/arena-manifest.json',
      target_profile: {
        active_role_id: 'base',
        subject_skill_id: 'gsap-core',
        loaded_skills: ['remember', 'gsap-core'],
        role_local_skills: [],
        registered_tools: ['read_file'],
        provider_visible_tools: ['read_file'],
        surface: 'pet',
      },
      sandbox: {
        engine: 'macos_seatbelt',
        mode: 'read_only',
        workspace_root: '/Users/guowei/private/arena/workspace',
        subject_root: '/Users/guowei/private/arena/skills/gsap-core',
        writable_roots: ['/Users/guowei/private/arena/home'],
        network: 'disabled',
        env_allowlist: [],
        timeout_ms: 120000,
      },
      created_at: '2026-06-30T01:05:00.000Z',
    }));
    fs.writeFileSync(path.join(runDir, 'arena-run.json'), JSON.stringify({
      version: 1,
      run_id: 'gsap-pass',
      review_mode: 'base_skill',
      subject_id: 'skill-gsap',
      subject_manifest_path: 'arena/subjects/skill-gsap/arena-manifest.json',
      target_profile: {
        active_role_id: 'base',
        subject_skill_id: 'gsap-core',
        loaded_skills: ['remember', 'gsap-core'],
        role_local_skills: [],
        registered_tools: ['read_file'],
        provider_visible_tools: ['read_file', 'edit_file'],
        surface: 'pet',
      },
      usercat_run_ref: {
        run_id: 'usercat-gsap',
        package_path: 'data/usercat-runs/usercat-gsap',
      },
      trace_refs: ['logs/sessions/pet/2026-06-30/session/traces.jsonl'],
      inspector_refs: ['data/inspector/issues/gsap.json'],
      replay_attempts: {
        planned: 3,
        completed: 3,
        pass_count: 3,
        fail_count: 0,
        blocked_count: 0,
        trace_refs: [],
      },
      sandbox: {
        engine: 'macos_seatbelt',
        mode: 'read_only',
        workspace_root: '/Users/guowei/private/arena/workspace',
        subject_root: '/Users/guowei/private/arena/skills/gsap-core',
        writable_roots: ['/Users/guowei/private/arena/home'],
        network: 'disabled',
        env_allowlist: [],
        timeout_ms: 120000,
      },
      decision: 'pass',
      scorecard_summary: 'passed',
      promotion: {},
      created_at: '2026-06-30T01:10:00.000Z',
    }));

    const summary = await getJson('/api/arena/summary');
    assert.strictEqual(summary.root, 'arena');
    assert.strictEqual(summary.totals.subjects, 1);
    assert.strictEqual(summary.totals.runs, 1);
    assert.strictEqual(summary.totals.reviewedRuns, 1);
    assert.strictEqual(summary.totals.decisions.pass, 1);
    assert.strictEqual(summary.subjects[0].name, 'gsap-core');
    assert.strictEqual(summary.runs[0].subjectName, 'gsap-core');
    assert.strictEqual(summary.runs[0].decision, 'pass');
    assert.strictEqual(summary.runs[0].replayCompleted, 3);
    assert.strictEqual(summary.runs[0].path, 'arena/runs/gsap-pass/arena-run.json');
    assert.doesNotMatch(JSON.stringify(summary), /\/Users\/guowei/);
  });

  test('does not expose observability action endpoint', async () => {
    const badAction = await fetch(`${baseUrl}/api/observability/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'shell' }),
    });
    assert.strictEqual(badAction.status, 404);

    const oldPatchAction = await fetch(`${baseUrl}/api/observability/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'benchmark-patch',
        targetSuitePath: '../contract-sentinel.json',
      }),
    });
    assert.strictEqual(oldPatchAction.status, 404);

    const removedGovernanceAction = await fetch(`${baseUrl}/api/observability/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'source-governance' }),
    });
    assert.strictEqual(removedGovernanceAction.status, 404);
  });

  async function getJson(pathname: string): Promise<any> {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.strictEqual(response.status, 200);
    return response.json();
  }

});
