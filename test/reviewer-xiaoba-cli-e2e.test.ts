import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReviewerXiaoBaCliE2ETool } from '../src/roles/reviewer-cat/tools/xiaoba-cli-e2e-tool';

describe('ReviewerXiaoBaCliE2ETool', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-reviewer-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  test('runs a tmux-style human interaction, verifier, trace, report, and scorecard', async () => {
    const fakeTmux = createFakeTmux(testRoot);
    const tool = new ReviewerXiaoBaCliE2ETool();

    const output = await tool.execute({
      run_id: 'tmux-pass',
      cwd: testRoot,
      tmux_binary: fakeTmux,
      command: 'node fake-engineer.js',
      messages: ['请像真实用户一样测试 engineer-cat 的边界'],
      startup_wait_ms: 0,
      wait_after_message_ms: 0,
      max_wait_ms: 0,
      verifier_commands: [{
        name: 'verifier-ok',
        command: 'node -e "console.log(\'verifier ok\')"',
      }],
    }, {
      workingDirectory: testRoot,
      conversationHistory: [],
    });

    const outputText = toolOutputText(output);
    assert.match(outputText, /reviewer_xiaoba_cli_e2e: status=pass/);
    assert.match(outputText, /score=/);

    const runDir = path.join(testRoot, 'data', 'reviewer-runs', 'tmux-pass');
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'trace', 'manifest.json'), 'utf-8'));
    const scorecard = JSON.parse(fs.readFileSync(path.join(runDir, 'scorecard.json'), 'utf-8'));
    const report = fs.readFileSync(path.join(runDir, 'report.md'), 'utf-8');
    const cleanPane = fs.readFileSync(path.join(runDir, 'trace', 'tmux-pane.clean.log'), 'utf-8');

    assert.strictEqual(manifest.decision, 'pass');
    assert.strictEqual(manifest.targetRole, 'engineer-cat');
    assert.strictEqual(scorecard.decision, 'pass');
    assert.ok(scorecard.rubric.minimumPassingScore >= 80);
    assert.strictEqual(scorecard.roleEffectiveness.role, 'engineer-cat');
    assert.match(scorecard.roleEffectiveness.rating, /effective|partial|ineffective/);
    assert.ok(scorecard.threeLayerEvidence.workingTrace);
    assert.match(report, /XiaoBa-CLI 真实端到端验收中文报告/);
    assert.match(report, /## 三层证据/);
    assert.match(report, /## 角色有效性评分/);
    assert.match(cleanPane, /ENGINEER:/);
    assert.ok(fs.existsSync(path.join(runDir, 'evidence', '01-verifier-ok.stdout.log')));

    const artifactManifest = tool.getArtifactManifest?.({
      run_id: 'tmux-pass',
      cwd: testRoot,
    }, outputText, {
      workingDirectory: testRoot,
      conversationHistory: [],
    }) ?? [];
    assert.deepEqual(artifactManifest.map(item => item.path), [
      'data/reviewer-runs/tmux-pass/e2e-task.json',
      'data/reviewer-runs/tmux-pass/trace/manifest.json',
      'data/reviewer-runs/tmux-pass/trace/normalized-transcript.jsonl',
      'data/reviewer-runs/tmux-pass/trace/tmux-captures.jsonl',
      'data/reviewer-runs/tmux-pass/trace/tmux-pane.raw.log',
      'data/reviewer-runs/tmux-pass/trace/tmux-pane.clean.log',
      'data/reviewer-runs/tmux-pass/scorecard.json',
      'data/reviewer-runs/tmux-pass/report.md',
      'data/reviewer-runs/tmux-pass/evidence/git-status.before.txt',
      'data/reviewer-runs/tmux-pass/evidence/git-status.after.txt',
      'data/reviewer-runs/tmux-pass/evidence/01-verifier-ok.stdout.log',
      'data/reviewer-runs/tmux-pass/evidence/01-verifier-ok.stderr.log',
    ]);
    assert.ok(artifactManifest.every(item => item.metadata?.source === 'tool_owned'));
    assert.ok(artifactManifest.some(item => item.metadata?.artifact_role === 'working_trace'));
    assert.ok(artifactManifest.some(item => item.metadata?.artifact_role === 'verifier_log'));
  });

  test('returns blocked and still writes artifacts when tmux is unavailable', async () => {
    const tool = new ReviewerXiaoBaCliE2ETool();

    const output = await tool.execute({
      run_id: 'tmux-blocked',
      cwd: testRoot,
      surface: 'tmux',
      tmux_binary: path.join(testRoot, 'missing-tmux'),
      verifier_commands: [{
        name: 'verifier-ok',
        command: 'node -e "console.log(\'verifier ok\')"',
      }],
    }, {
      workingDirectory: testRoot,
      conversationHistory: [],
    });

    const outputText = toolOutputText(output);
    assert.match(outputText, /reviewer_xiaoba_cli_e2e: status=blocked/);
    assert.match(outputText, /blocked_reason=tmux unavailable/);

    const runDir = path.join(testRoot, 'data', 'reviewer-runs', 'tmux-blocked');
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'trace', 'manifest.json'), 'utf-8'));
    const scorecard = JSON.parse(fs.readFileSync(path.join(runDir, 'scorecard.json'), 'utf-8'));

    assert.strictEqual(manifest.decision, 'blocked');
    assert.strictEqual(scorecard.decision, 'blocked');
    assert.ok(scorecard.threeLayerEvidence.issues.includes('working trace evidence missing'));
    assert.ok(fs.existsSync(path.join(runDir, 'report.md')));
  });

  test('falls back to process surface in auto mode when tmux is unavailable', async () => {
    const fakeEngineer = createFakeEngineer(testRoot);
    const tool = new ReviewerXiaoBaCliE2ETool();

    const output = await tool.execute({
      run_id: 'process-fallback',
      cwd: testRoot,
      tmux_binary: path.join(testRoot, 'missing-tmux'),
      command: `node ${JSON.stringify(fakeEngineer)}`,
      messages: ['请测试 engineer-cat 能否澄清需求并给出证据'],
      startup_wait_ms: 0,
      wait_after_message_ms: 100,
      max_wait_ms: 100,
      verifier_commands: [{
        name: 'verifier-ok',
        command: 'node -e "console.log(\'verifier ok\')"',
      }],
    }, {
      workingDirectory: testRoot,
      conversationHistory: [],
    });

    const outputText = toolOutputText(output);
    assert.match(outputText, /reviewer_xiaoba_cli_e2e: status=pass/);
    assert.match(outputText, /surface=process/);
    assert.match(outputText, /fallback_reason=tmux unavailable/);

    const runDir = path.join(testRoot, 'data', 'reviewer-runs', 'process-fallback');
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'trace', 'manifest.json'), 'utf-8'));
    const scorecard = JSON.parse(fs.readFileSync(path.join(runDir, 'scorecard.json'), 'utf-8'));
    const cleanPane = fs.readFileSync(path.join(runDir, 'trace', 'tmux-pane.clean.log'), 'utf-8');

    assert.strictEqual(manifest.requestedSurface, 'auto');
    assert.strictEqual(manifest.surface, 'process');
    assert.strictEqual(manifest.decision, 'pass');
    assert.strictEqual(manifest.blockedReason, undefined);
    assert.match(manifest.fallbackReason, /tmux unavailable/);
    assert.strictEqual(scorecard.decision, 'pass');
    assert.strictEqual(scorecard.roleEffectiveness.role, 'engineer-cat');
    assert.ok(scorecard.rubric.dimensions.some((dimension: any) => dimension.id === 'threeLayerEvidence'));
    assert.match(cleanPane, /ENGINEER:/);
  });

  test('hard blocks arbitrary command, messages, and verifiers in an evolution DAG parent', async () => {
    const tool = new ReviewerXiaoBaCliE2ETool();
    const commandSentinel = path.join(testRoot, 'command-ran');
    const verifierSentinel = path.join(testRoot, 'verifier-ran');

    const output = await tool.execute({
      run_id: 'dag-must-not-run',
      command: `node -e "require('fs').writeFileSync(${JSON.stringify(commandSentinel)}, 'bad')"`,
      messages: ['修改生产代码'],
      verifier_commands: [{
        name: 'mutating-verifier',
        command: `node -e "require('fs').writeFileSync(${JSON.stringify(verifierSentinel)}, 'bad')"`,
      }],
    }, {
      workingDirectory: testRoot,
      conversationHistory: [],
      roleName: 'reviewer-cat',
      parentSessionId: 'evolution:dag:2026-07-14',
    });

    assert.notStrictEqual(typeof output, 'string');
    if (typeof output === 'string') assert.fail('evolution DAG must return a structured blocked result');
    assert.strictEqual(output.status, 'blocked');
    assert.strictEqual(output.error_code, 'REVIEWER_ARBITRARY_E2E_FORBIDDEN_IN_EVOLUTION_DAG');
    assert.strictEqual(fs.existsSync(commandSentinel), false);
    assert.strictEqual(fs.existsSync(verifierSentinel), false);
    assert.strictEqual(fs.existsSync(path.join(testRoot, 'data', 'reviewer-runs', 'dag-must-not-run')), false);
  });
});

function toolOutputText(output: Awaited<ReturnType<ReviewerXiaoBaCliE2ETool['execute']>>): string {
  return typeof output === 'string' ? output : String(output.toolContent);
}

function createFakeEngineer(root: string): string {
  const scriptPath = path.join(root, 'fake-engineer.js');
  const script = `#!/usr/bin/env node
process.stdin.setEncoding('utf-8');
console.log('ENGINEER: ready');
process.stdin.on('data', chunk => {
  const text = String(chunk);
  process.stdout.write('USER: ' + text);
  if (text.includes('/exit')) process.exit(0);
  console.log('ENGINEER: 我会先澄清需求，再给出验证证据。已完成 验证 done');
});
`;
  fs.writeFileSync(scriptPath, script, 'utf-8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function createFakeTmux(root: string): string {
  const scriptPath = path.join(root, 'fake-tmux.js');
  const statePath = path.join(root, 'fake-tmux-pane.log');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const pane = ${JSON.stringify(statePath)};
const buffer = pane + '.buffer';
const args = process.argv.slice(2);
function append(text) { fs.appendFileSync(pane, text); }
if (args[0] === '-V') {
  console.log('tmux 3.4');
  process.exit(0);
}
if (args[0] === 'new-session') {
  append('SESSION STARTED\\n' + args[args.length - 1] + '\\n> ');
  process.exit(0);
}
if (args[0] === 'set-buffer') {
  const index = args.indexOf('-b');
  fs.writeFileSync(buffer, args.slice(index + 2).join(' '));
  process.exit(0);
}
if (args[0] === 'paste-buffer') {
  const text = fs.existsSync(buffer) ? fs.readFileSync(buffer, 'utf-8') : '';
  append('USER: ' + text + '\\n');
  append('ENGINEER: 我会先澄清边界，然后给出验证证据。已完成 验证 done\\n> ');
  process.exit(0);
}
if (args[0] === 'send-keys') {
  process.exit(0);
}
if (args[0] === 'capture-pane') {
  process.stdout.write(fs.existsSync(pane) ? fs.readFileSync(pane, 'utf-8') : '');
  process.exit(0);
}
if (args[0] === 'kill-session') {
  append('SESSION KILLED\\n');
  process.exit(0);
}
console.error('unknown fake tmux command: ' + args.join(' '));
process.exit(2);
`;
  fs.writeFileSync(scriptPath, script, 'utf-8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}
