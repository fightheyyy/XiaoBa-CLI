import { after, afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArenaManager, DEFAULT_PACKAGED_BASE_SKILLS } from '../src/arena/arena-manager';
import { executeArenaRun, runArenaPipelineWorker } from '../src/arena/arena-runner';
import { ArenaReplayStageInput, ArenaUserCatStageInput } from '../src/arena/arena-runner';
import { TraceReplayReport } from '../src/replay/trace-replay-runner';
import { RoleResolver } from '../src/utils/role-resolver';

const originalCwd = process.cwd();
const originalProjectRoot = process.env.XIAOBA_PROJECT_ROOT;
const originalSkillsRoot = process.env.XIAOBA_SKILLS_ROOT;
const originalRolesRoot = process.env.XIAOBA_ROLES_ROOT;
const originalDotenvConfigPath = process.env.DOTENV_CONFIG_PATH;

describe('Arena runner', () => {
  let testRoot = '';
  let manager: ArenaManager;

  beforeEach(() => {
    RoleResolver.clearActiveRole();
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-arena-runner-'));
    process.chdir(testRoot);
    delete process.env.XIAOBA_PROJECT_ROOT;
    delete process.env.XIAOBA_SKILLS_ROOT;
    delete process.env.XIAOBA_ROLES_ROOT;
    delete process.env.DOTENV_CONFIG_PATH;
    manager = new ArenaManager({
      projectRoot: testRoot,
      now: () => new Date('2026-06-30T00:00:00.000Z'),
    });
    writeBaseSkills(testRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  after(() => {
    process.chdir(originalCwd);
    restoreEnv('XIAOBA_PROJECT_ROOT', originalProjectRoot);
    restoreEnv('XIAOBA_SKILLS_ROOT', originalSkillsRoot);
    restoreEnv('XIAOBA_ROLES_ROOT', originalRolesRoot);
    restoreEnv('DOTENV_CONFIG_PATH', originalDotenvConfigPath);
  });

  test('worker turns clean runtime evidence into an Arena scorecard and run index', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'hang-to-la'), {
        name: 'hang-to-la',
        description: 'Tests a tiny command helper',
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-pass',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    let userCatInput: ArenaUserCatStageInput | undefined;
    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-pass',
      messages: ['这个 skill 我不会用，你先帮我试一下。'],
      replayAttempts: 2,
    }, {
      now: () => new Date('2026-06-30T00:01:00.000Z'),
      runUserCat: async input => {
        userCatInput = input;
        return writeFakeUserCatEvidence(input);
      },
      analyzeLog: async () => JSON.stringify({
        summary: { totalTurns: 2, issueCount: 0 },
        issues: [],
        toolStats: [],
      }),
      runReplay: async input => writeFakeReplay(input),
    });

    assert.strictEqual(scorecard.decision, 'pass');
    assert.strictEqual((scorecard.replay_attempts as any).planned, 0);
    assert.strictEqual((scorecard.replay_attempts as any).pass_count, 0);
    const runRoot = path.join(testRoot, 'arena', 'runs', 'pipeline-pass');
    assert.ok(fs.existsSync(path.join(runRoot, 'arena-scorecard.json')));
    assert.ok(fs.existsSync(path.join(runRoot, 'arena-run.json')));
    assert.ok(fs.existsSync(path.join(runRoot, 'debug', 'inspector-cases.json')));
    assert.ok(fs.existsSync(path.join(runRoot, 'debug', 'reviewer-report.md')));
    const reviewerReport = fs.readFileSync(path.join(runRoot, 'debug', 'reviewer-report.md'), 'utf-8');
    assert.match(reviewerReport, /Arena Reviewer 中文报告/);
    assert.match(reviewerReport, /## 评测轮次/);
    assert.match(reviewerReport, /## 证据/);
    assert.match(reviewerReport, /## 复跑结果/);
    assert.ok(!fs.existsSync(path.join(runRoot, 'usercat')));
    assert.ok(!fs.existsSync(path.join(runRoot, 'inspector')));
    assert.ok(!fs.existsSync(path.join(runRoot, 'reviewer')));
    assert.strictEqual((scorecard.evidence as any).arena_run, 'arena/runs/pipeline-pass/arena-run.json');
    assert.strictEqual((scorecard.evidence as any).debug_dir, 'arena/runs/pipeline-pass/debug');
    assert.deepStrictEqual((scorecard.evidence as any).trace_refs, [
      'arena/runs/pipeline-pass/workspace/logs/sessions/pet/2026-06-30/pipeline-pass-usercat/traces.jsonl',
    ]);
    assert.match((scorecard.debug_refs as any).usercat_controller_trace, /workspace\/data\/user-cat\/traces/);
    assert.strictEqual((scorecard.stages as any).usercat.status, 'pass');
    assert.strictEqual((scorecard.stages as any).inspector.status, 'pass');
    assert.strictEqual((scorecard.stages as any).reviewer.status, 'pass');
    assert.strictEqual(userCatInput?.messages.length, 4);
    assert.strictEqual(userCatInput?.messages[0], '这个 skill 我不会用，你先帮我试一下。');
    assert.match(userCatInput?.messages[1] || '', /到底能用了吗/);
  });

  test('worker does not pass stable provider or environment failures', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'auth-blocked-skill'), {
        name: 'auth-blocked-skill',
        description: 'Needs the target runtime to answer visibly',
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-auth-blocked',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-auth-blocked',
      scenarioCount: 1,
      replayAttempts: 2,
    }, {
      now: () => new Date('2026-06-30T00:02:00.000Z'),
      runUserCat: async input => writeFakeUserCatEvidence(input),
      analyzeLog: async () => JSON.stringify({
        summary: { totalTurns: 2, issueCount: 1 },
        issues: [{
          type: 'error',
          severity: 'medium',
          description: 'Turn 1: provider auth failed before the skill could run',
          context: 'API密钥未配置。请先运行: xiaoba config',
        }],
      }),
      runReplay: async input => writeFakeReplay(input),
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.match(String(scorecard.summary), /blocked/);
    assert.strictEqual((scorecard.replay_attempts as any).planned, 0);
    assert.strictEqual((scorecard.replay_attempts as any).pass_count, 0);
  });

  test('normal profile runs three UserCat scenarios without replay when Inspector finds no case', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'normal-skill'), {
        name: 'normal-skill',
        description: 'Normal Arena profile skill',
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-normal',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const userCatInputs: ArenaUserCatStageInput[] = [];
    const replayInputs: ArenaReplayStageInput[] = [];
    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-normal',
      replayAttempts: 2,
    }, {
      now: () => new Date('2026-06-30T00:03:00.000Z'),
      runUserCat: async input => {
        userCatInputs.push(input);
        return writeFakeUserCatEvidence(input);
      },
      analyzeLog: async () => JSON.stringify({
        summary: { totalTurns: 2, issueCount: 0 },
        issues: [],
        toolStats: [],
      }),
      runReplay: async input => {
        replayInputs.push(input);
        return writeFakeReplay(input);
      },
    });

    assert.strictEqual((scorecard.arena_eval_profile as any).profile, 'normal');
    assert.strictEqual((scorecard.arena_eval_profile as any).scenario_count, 3);
    assert.strictEqual((scorecard.arena_eval_profile as any).max_usercat_turns, 4);
    assert.strictEqual((scorecard.arena_eval_profile as any).replay_attempts_per_case, 2);
    assert.strictEqual((scorecard.arena_eval_profile as any).replay_case_count, 0);
    assert.strictEqual((scorecard.replay_attempts as any).planned, 0);
    assert.strictEqual((scorecard.replay_attempts as any).completed, 0);
    assert.strictEqual((scorecard.replay_attempts as any).pass_count, 0);
    assert.strictEqual(userCatInputs.length, 3);
    assert.deepStrictEqual(userCatInputs.map(input => input.scenarioIndex), [1, 2, 3]);
    assert.ok(userCatInputs.every(input => input.messages.length === 4));
    assert.strictEqual(replayInputs.length, 0);
  });

  test('Reviewer replays only Inspector cases', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'case-skill'), {
        name: 'case-skill',
        description: 'Arena case replay skill',
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-case',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const replayInputs: ArenaReplayStageInput[] = [];
    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-case',
      scenarioCount: 1,
      replayAttempts: 2,
    }, {
      now: () => new Date('2026-06-30T00:04:00.000Z'),
      runUserCat: async input => writeFakeUserCatEvidence(input),
      analyzeLog: async () => JSON.stringify({
        summary: { totalTurns: 2, issueCount: 1 },
        issues: [{
          type: 'tool_failure',
          severity: 'medium',
          description: 'tool failed before visible artifact',
          context: 'python command not found',
        }],
        toolStats: [],
      }),
      runReplay: async input => {
        replayInputs.push(input);
        return writeFakeReplay(input);
      },
    });

    assert.strictEqual((scorecard.arena_eval_profile as any).scenario_count, 1);
    assert.strictEqual((scorecard.arena_eval_profile as any).replay_case_count, 1);
    assert.strictEqual((scorecard.arena_eval_profile as any).replay_attempts_per_case, 2);
    assert.strictEqual((scorecard.replay_attempts as any).planned, 2);
    assert.strictEqual((scorecard.replay_attempts as any).completed, 2);
    assert.strictEqual(replayInputs.length, 2);
    assert.ok(replayInputs.every(input => input.caseId?.includes('tool_failure')));
    assert.deepStrictEqual(replayInputs.map(input => input.scenarioAttemptIndex), [1, 2]);
  });

  test('Reviewer deduplicates slow-tool cases and caps selected replay cases', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'many-case-skill'), {
        name: 'many-case-skill',
        description: 'Arena case selection skill',
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-case-cap',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const replayInputs: ArenaReplayStageInput[] = [];
    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-case-cap',
      scenarioCount: 1,
      replayAttempts: 1,
      maxReplayCases: 2,
    }, {
      now: () => new Date('2026-06-30T00:05:00.000Z'),
      runUserCat: async input => writeFakeUserCatEvidence(input),
      analyzeLog: async () => JSON.stringify({
        summary: { totalTurns: 2, issueCount: 4 },
        issues: [
          {
            type: 'slow_tool',
            severity: 'high',
            description: 'tool execute_shell took 50000ms',
            context: 'tool execute_shell took 50000ms',
          },
          {
            type: 'slow_tool_pattern',
            severity: 'medium',
            description: 'tool execute_shell average latency is high',
            context: 'tool execute_shell average latency is high',
          },
          {
            type: 'slow_tool',
            severity: 'medium',
            description: 'tool execute_shell took 25000ms',
            context: 'tool execute_shell took 25000ms',
          },
          {
            type: 'tool_failure',
            severity: 'medium',
            description: 'tool failed before visible artifact',
            context: 'python command not found',
          },
        ],
        toolStats: [],
      }),
      runReplay: async input => {
        replayInputs.push(input);
        return writeFakeReplay(input);
      },
    });

    assert.strictEqual((scorecard.arena_eval_profile as any).inspector_case_count, 4);
    assert.strictEqual((scorecard.arena_eval_profile as any).replay_candidate_case_count, 4);
    assert.strictEqual((scorecard.arena_eval_profile as any).replay_case_count, 2);
    assert.strictEqual((scorecard.arena_eval_profile as any).skipped_replay_case_count, 2);
    assert.strictEqual((scorecard.replay_attempts as any).planned, 2);
    assert.strictEqual(replayInputs.length, 2);
    assert.ok(replayInputs.some(input => input.caseId?.includes('slow_tool')));
    assert.ok(replayInputs.some(input => input.caseId?.includes('tool_failure')));
  });

  test('Inspector emits wrong_output_schema when answer.json misses requested fake_citations', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'schema-skill'), {
        name: 'schema-skill',
        description: 'Arena schema inspection skill',
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-schema-case',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-schema-case',
      scenarioCount: 1,
      replayAttempts: 1,
      maxReplayCases: 2,
      messages: [
        '请生成 answer.json，里面必须有 fake_citations 列表。',
        '路径在哪里？',
      ],
    }, {
      now: () => new Date('2026-06-30T00:06:00.000Z'),
      runUserCat: async input => {
        const result = await writeFakeUserCatEvidence(input);
        writeJson(path.join(input.workspaceRoot, 'answer.json'), [
          'Blockchain Applications in Supply Chain Management',
        ]);
        return result;
      },
      analyzeLog: async () => JSON.stringify({
        summary: { totalTurns: 2, issueCount: 0 },
        issues: [],
        toolStats: [],
      }),
      runReplay: async input => writeFakeReplay(input),
    });

    const runRoot = path.join(testRoot, 'arena', 'runs', 'pipeline-schema-case');
    const inspectorCases = JSON.parse(fs.readFileSync(path.join(runRoot, 'debug', 'inspector-cases.json'), 'utf-8'));
    assert.ok(inspectorCases.cases.some((item: any) => item.issue_type === 'wrong_output_schema'));
    assert.strictEqual((scorecard.arena_eval_profile as any).replay_case_count, 1);
    assert.strictEqual((scorecard.replay_attempts as any).planned, 1);
  });

  test('execute dry-run writes a sandbox_shell_command runner plan', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'dry-skill'), {
        name: 'dry-skill',
        description: 'Dry run skill',
      }),
    });

    const result = await executeArenaRun({
      projectRoot: testRoot,
      runId: 'dry-run',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      dryRun: true,
      scenarioCount: 2,
      sandbox: { engine: 'macos_seatbelt' },
    });

    assert.strictEqual(result.status, 'dry_run');
    assert.strictEqual(result.command_kind, 'sandbox_shell_command');
    assert.strictEqual(result.sandbox_enforced, true);
    const runner = JSON.parse(fs.readFileSync(result.runner_path, 'utf-8'));
    assert.match(runner.sandbox_shell_command, /sandbox-exec/);
    assert.match(runner.sandbox_shell_command, /XIAOBA_ARENA_SANDBOXED='1'/);
    assert.match(runner.sandbox_shell_command, /arena' 'run' 'worker/);
    assert.deepStrictEqual(runner.worker_command.slice(-2), ['--scenario-count', '2']);
    const profile = fs.readFileSync(path.join(testRoot, 'arena', 'runs', 'dry-run', 'sandbox', 'macos-seatbelt.sb'), 'utf-8');
    assert.ok(profile.includes(path.join(testRoot, 'arena', 'runs', 'dry-run')));
    assert.match(profile, /\(allow mach-lookup\)/);
    assert.match(profile, /\(allow file-map-executable\)/);
    assert.match(profile, /\(allow file-read\*\)/);
    assert.match(profile, /\(allow file-write-data \(subpath "\/dev"\)\)/);
    assert.match(profile, /\(allow file-read\* \(subpath "\/dev"\)\)/);
    assert.match(profile, /\(allow network\*\)/);
    assert.doesNotMatch(profile, /\(deny network\*\)/);
  });

  test('execute dry-run prepares clean workspace from seed directory', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'seed-run-skill'), {
        name: 'seed-run-skill',
        description: 'Dry run seeded skill',
      }),
    });
    writeJson(path.join(testRoot, 'fixtures', 'workspace-seed', 'employee_data.json'), { name: 'Sarah Chen' });

    const result = await executeArenaRun({
      projectRoot: testRoot,
      runId: 'dry-run-seeded',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      workspaceSeedPath: 'fixtures/workspace-seed',
      dryRun: true,
      scenarioCount: 1,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const runtime = JSON.parse(fs.readFileSync(result.clean_runtime_path, 'utf-8'));
    assert.deepStrictEqual(runtime.copied.workspace_seed, {
      source: 'fixtures/workspace-seed',
      file_count: 1,
    });
    assert.ok(fs.existsSync(path.join(testRoot, 'arena', 'runs', 'dry-run-seeded', 'workspace', 'employee_data.json')));
  });

  test('execute fails fast when clean runtime has no provider config', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'missing-env-skill'), {
        name: 'missing-env-skill',
        description: 'Needs provider config',
      }),
    });

    await assert.rejects(
      () => executeArenaRun({
        projectRoot: testRoot,
        runId: 'missing-env-run',
        reviewMode: 'base_skill',
        subjectId: manifest.subject_id,
        sandbox: { engine: 'macos_seatbelt' },
      }),
      /需要先配置 XiaoBa provider/,
    );

    const runRoot = path.join(testRoot, 'arena', 'runs', 'missing-env-run');
    assert.ok(fs.existsSync(path.join(runRoot, 'clean-runtime.json')));
    assert.ok(!fs.existsSync(path.join(runRoot, 'arena-runner.json')));
  });
});

async function writeFakeUserCatEvidence(input: ArenaUserCatStageInput): Promise<string> {
  const rawTrace = path.join(input.workspaceRoot, 'data', 'user-cat', 'traces', input.usercatRunId, 'trace.jsonl');
  const candidateDir = path.join(input.workspaceRoot, 'output', 'user-cat', 'candidates', input.usercatRunId);
  const nativeTrace = path.join(input.workspaceRoot, 'logs', 'sessions', 'pet', '2026-06-30', input.usercatRunId, 'traces.jsonl');
  writeJsonl(rawTrace, [
    { type: 'run_start', run_id: input.usercatRunId },
    { type: 'user_turn', text: input.messages[0] },
    { type: 'assistant_turn', text: 'done with evidence' },
  ]);
  writeJson(path.join(candidateDir, 'manifest.json'), {
    version: 1,
    run_id: input.usercatRunId,
    target_role: input.targetRole,
    trace_path: path.relative(input.workspaceRoot, rawTrace),
  });
  writeJsonl(nativeTrace, [
    {
      entry_type: 'trace',
      trace_id: 'trace-1',
      trace_index: 1,
      timestamp: '2026-06-30T00:00:00.000Z',
      session_id: 'pet:xiaoba',
      session_type: 'pet',
      turn: 1,
      user: { text: input.messages[0] },
      assistant: { text: 'done with evidence' },
      tokens: { prompt: 1, completion: 1 },
      metadata: { token: 'usage counter only' },
    },
    {
      entry_type: 'trace',
      trace_id: 'trace-2',
      trace_index: 2,
      timestamp: '2026-06-30T00:00:01.000Z',
      session_id: 'pet:xiaoba',
      session_type: 'pet',
      turn: 2,
      user: { text: input.messages[1] || '证据在哪' },
      assistant: { text: 'arena/runs/pipeline-pass/workspace/output/result.txt' },
      tokens: { prompt: 1, completion: 1 },
    },
  ]);
  return [
    'user_trace_run: status=completed',
    `run_id=${input.usercatRunId}`,
    `target_role=${input.targetRole}`,
    `turn_count=${input.messages.length}`,
    `trace=${path.relative(input.workspaceRoot, rawTrace)}`,
    `candidate_dir=${path.relative(input.workspaceRoot, candidateDir)}`,
    `candidate_case=${path.relative(input.workspaceRoot, path.join(candidateDir, 'candidate-case.json'))}`,
  ].join('\n');
}

async function writeFakeReplay(input: ArenaReplayStageInput): Promise<TraceReplayReport> {
  const outDir = input.replayOutDir;
  const replayResultsPath = path.join(outDir, 'replay-results.json');
  const freshTracePath = path.join(outDir, 'fresh-trace.jsonl');
  writeJson(replayResultsPath, { status: 'pass', attempt: input.attemptIndex });
  writeJson(path.join(outDir, 'manifest.json'), { attempt: input.attemptIndex });
  writeJsonl(freshTracePath, [
    {
      entry_type: 'trace',
      trace_id: `replay-${input.attemptIndex}`,
      trace_index: 1,
      timestamp: '2026-06-30T00:00:00.000Z',
      session_id: `pet:xiaoba:fake-${input.attemptIndex}`,
      session_type: 'pet',
      turn: 1,
      user: { text: '帮我看' },
      assistant: { text: 'ok' },
    },
  ]);
  return {
    replay_version: '0.1',
    run_id: `fake-replay-${input.attemptIndex}`,
    generated_at: '2026-06-30T00:00:00.000Z',
    input_trace_path: input.tracePath,
    out_dir: outDir,
    pet_id: 'xiaoba',
    session_key: `pet:xiaoba:role-${input.targetRole}:fake-${input.attemptIndex}`,
    replayed_turns: 2,
    fresh_trace_path: freshTracePath,
    artifacts: {
      manifest_path: path.join(outDir, 'manifest.json'),
      extracted_inputs_path: path.join(outDir, 'extracted-inputs.json'),
      replay_results_path: replayResultsPath,
      comparison_path: path.join(outDir, 'comparison.json'),
      report_path: path.join(outDir, 'report.md'),
    },
    inputs: [
      { index: 1, sourceLine: 1, text: '帮我看' },
      { index: 2, sourceLine: 2, text: '证据在哪' },
    ],
    results: [
      { index: 1, sourceLine: 1, ok: true, durationMs: 1, text: 'ok', textEventCount: 1, files: [], tools: [], eventCount: 1 },
      { index: 2, sourceLine: 2, ok: true, durationMs: 1, text: 'ok', textEventCount: 1, files: [], tools: [], eventCount: 1 },
    ],
    comparison: {
      oldTrace: {
        traceCount: 2,
        userTexts: ['帮我看', '证据在哪'],
        toolCounts: {},
        deliveryEvidenceCount: 1,
        visibleCompletedCount: 1,
        finalVisibleCount: 0,
        failedTools: [],
      },
      newTrace: {
        traceCount: 2,
        userTexts: ['帮我看', '证据在哪'],
        toolCounts: {},
        deliveryEvidenceCount: 2,
        visibleCompletedCount: 2,
        finalVisibleCount: 0,
        failedTools: [],
      },
      inputCountMatches: true,
      userInputsReplayed: true,
      slashCommandsMissingFromTrace: false,
      notes: [],
    },
  };
}

function writeBaseSkills(root: string): void {
  for (const skill of DEFAULT_PACKAGED_BASE_SKILLS) {
    writeSkill(path.join(root, 'skills', skill), {
      name: skill,
      description: `${skill} base skill`,
    });
  }
}

function writeSkill(
  dirPath: string,
  input: { name: string; description: string },
): string {
  fs.mkdirSync(dirPath, { recursive: true });
  const skillPath = path.join(dirPath, 'SKILL.md');
  fs.writeFileSync(skillPath, [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    '---',
    '',
    'Use evidence.',
    '',
  ].join('\n'), 'utf-8');
  return skillPath;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function writeJsonl(filePath: string, values: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${values.map(value => JSON.stringify(value)).join('\n')}\n`, 'utf-8');
}

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
  } else {
    delete process.env[key];
  }
}
