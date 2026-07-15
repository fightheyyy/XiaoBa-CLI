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
const STRICT_OUTPUT_PREFIXES = [
  'MEOW_RESULT::',
  'MEOW_EVIDENCE::',
  'MEOW_RISK::',
  'MEOW_NEXT::',
];

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
    assert.deepStrictEqual(scorecard.output_contract_check, {
      declared: false,
      source_ref: null,
      expected_turns: 0,
      checked_turns: 0,
      passed_turns: 0,
      violation_count: 0,
      fully_compliant_sessions: 0,
      total_sessions: 1,
      status: 'not_declared',
    });
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

  test('passes a declared output contract only when every native turn is covered and compliant', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-pass'), {
        name: 'strict-pass',
        description: 'Strict two-turn output skill',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-pass',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-pass',
      scenarioCount: 1,
      maxTurns: 2,
      replayAttempts: 1,
    }, {
      runUserCat: async input => writeStrictUserCatEvidence(input, [
        [strictOutput('first')],
        [strictOutput('second')],
      ]),
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [
        [strictOutput('replay first')],
        [strictOutput('replay second')],
      ]),
    });

    assert.strictEqual(scorecard.decision, 'pass');
    assert.deepStrictEqual(scorecard.output_contract_check, {
      declared: true,
      source_ref: 'arena/runs/pipeline-strict-pass/skills/strict-pass/SKILL.md',
      expected_turns: 2,
      checked_turns: 2,
      passed_turns: 2,
      violation_count: 0,
      fully_compliant_sessions: 1,
      total_sessions: 1,
      status: 'pass',
    });
  });

  test('blocks reused native sessions instead of counting one trace as multiple UserCat runs', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-independent-sessions'), {
        name: 'strict-independent-sessions',
        description: 'Strict output requires independent Arena sessions',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-independent-sessions',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const sharedSession = 'pet:xiaoba:role-base:shared-arena-session';
    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-independent-sessions',
      scenarioCount: 2,
      maxTurns: 1,
      replayAttempts: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(
          input,
          [[strictOutput(`scenario ${input.scenarioIndex}`)]],
          1,
          sharedSession,
        );
        if (input.scenarioIndex === 2) {
          fs.rmSync(path.join(
            input.workspaceRoot,
            'logs',
            'sessions',
            'pet',
            '2026-06-30',
            input.usercatRunId,
          ), { recursive: true, force: true });
        }
        return result;
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [[strictOutput('replay')]]),
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.strictEqual((scorecard.output_contract_check as any).status, 'blocked');
    assert.strictEqual((scorecard.trace_identity_check as any).status, 'blocked');
    assert.match(
      (scorecard.cases as any[]).find(item => item.issue_type === 'trace_identity_blocked')
        .suspected_root_cause,
      /reused by multiple runs/,
    );
  });

  test('blocks reused native sessions for a Role without a strict output contract', async () => {
    const roleRoot = path.join(testRoot, 'fixtures', 'roles', 'identity-role');
    writeJson(path.join(roleRoot, 'role.json'), {
      name: 'identity-role',
      displayName: 'IdentityRole',
      description: 'Role candidate whose native traces must be independent.',
      promptFile: 'identity-role-system-prompt.md',
      status: 'candidate',
    });
    fs.mkdirSync(path.join(roleRoot, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(roleRoot, 'prompts', 'identity-role-system-prompt.md'), '# IdentityRole\n', 'utf-8');
    const manifest = manager.importLocalRole({ rolePath: roleRoot });
    manager.prepareCleanRuntime({
      runId: 'pipeline-role-independent-sessions',
      reviewMode: 'role',
      subjectId: manifest.subject_id,
      targetRoleId: 'identity-role',
      sandbox: { engine: 'macos_seatbelt' },
    });

    const sharedSession = 'pet:xiaoba:role-identity-role:shared-arena-session';
    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-role-independent-sessions',
      scenarioCount: 2,
      maxTurns: 1,
      replayAttempts: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(
          input,
          [['ordinary role output']],
          1,
          sharedSession,
        );
        if (input.scenarioIndex === 2) {
          fs.rmSync(path.join(
            input.workspaceRoot,
            'logs',
            'sessions',
            'pet',
            '2026-06-30',
            input.usercatRunId,
          ), { recursive: true, force: true });
        }
        return result;
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplay(input),
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.strictEqual((scorecard.output_contract_check as any).status, 'not_declared');
    assert.strictEqual((scorecard.trace_identity_check as any).status, 'blocked');
    assert.match(
      (scorecard.cases as any[]).find(item => item.issue_type === 'trace_identity_blocked')
        .suspected_root_cause,
      /reused by multiple runs/,
    );
  });

  test('blocks trace_id reuse across otherwise independent native sessions', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'global-trace-identity'), {
        name: 'global-trace-identity',
        description: 'Trace identities must be unique across the whole Arena batch',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-global-trace-identity',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    let sharedTraceId = '';
    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-global-trace-identity',
      scenarioCount: 2,
      maxTurns: 1,
      replayAttempts: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(
          input,
          [[strictOutput(`scenario ${input.scenarioIndex}`)]],
          1,
        );
        const nativeTrace = path.join(
          input.workspaceRoot,
          'logs',
          'sessions',
          'pet',
          '2026-06-30',
          input.usercatRunId,
          'traces.jsonl',
        );
        const rows = fs.readFileSync(nativeTrace, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
        if (input.scenarioIndex === 1) sharedTraceId = rows[0].trace_id;
        else rows[0].trace_id = sharedTraceId;
        writeJsonl(nativeTrace, rows);
        return result;
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [[strictOutput('replay')]]),
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.strictEqual((scorecard.trace_identity_check as any).status, 'blocked');
    assert.ok((scorecard.cases as any[]).some(item => (
      item.issue_type === 'trace_identity_blocked'
      && /trace_id .* reused across multiple claimed sessions/.test(item.suspected_root_cause)
    )));
  });

  test('rejects hidden direct final text when the declared contract requires one send_text delivery', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-hidden-final'), {
        name: 'strict-hidden-final',
        description: 'Strict output must be delivered through Pet',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-hidden-final',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-hidden-final',
      scenarioCount: 1,
      maxTurns: 1,
      replayAttempts: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(input, [[strictOutput('delivered only as final text')]]);
        const nativeTrace = path.join(
          input.workspaceRoot,
          'logs',
          'sessions',
          'pet',
          '2026-06-30',
          input.usercatRunId,
          'traces.jsonl',
        );
        const rows = fs.readFileSync(nativeTrace, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
        rows[0].assistant = { text: strictOutput('hidden direct final'), tool_calls: [] };
        writeJsonl(nativeTrace, rows);
        return result;
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [[strictOutput('replay')]]),
    });

    assert.strictEqual(scorecard.decision, 'unstable');
    assert.strictEqual((scorecard.output_contract_check as any).status, 'fail');
    assert.strictEqual((scorecard.output_contract_check as any).passed_turns, 0);
    assert.match(
      (scorecard.cases as any[]).find(item => item.issue_type === 'output_contract_violation').suspected_root_cause,
      /expected exactly one send_text delivery; observed 0/,
    );
  });

  test('rejects extra assistant text even when the single send_text delivery is compliant', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-extra-final'), {
        name: 'strict-extra-final',
        description: 'Strict output forbids extra assistant text',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-extra-final',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-extra-final',
      scenarioCount: 1,
      maxTurns: 1,
      replayAttempts: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(input, [[strictOutput('delivered')]]);
        const nativeTrace = path.join(
          input.workspaceRoot,
          'logs',
          'sessions',
          'pet',
          '2026-06-30',
          input.usercatRunId,
          'traces.jsonl',
        );
        const rows = fs.readFileSync(nativeTrace, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
        rows[0].assistant.text = 'extra direct final text';
        writeJsonl(nativeTrace, rows);
        return result;
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [[strictOutput('replay')]]),
    });

    assert.strictEqual(scorecard.decision, 'unstable');
    assert.strictEqual((scorecard.output_contract_check as any).status, 'fail');
    assert.match(
      (scorecard.cases as any[]).find(item => item.issue_type === 'output_contract_violation').suspected_root_cause,
      /unexpected assistant text outside the send_text delivery/,
    );
  });

  test('reclassifies the preserved v3-shaped six-turn evidence as two violations, not pass', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'evo-closeout-v1'), {
        name: 'evo-closeout-v1',
        description: 'Strict four-line evolution closeout',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-evo-v3-shaped',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-evo-v3-shaped',
      replayAttempts: 1,
      maxReplayCases: 2,
    }, {
      runUserCat: async input => {
        if (input.scenarioIndex === 1) {
          return writeStrictUserCatEvidence(input, [
            [strictOutput('scenario one first')],
            ['plain follow-up one', 'plain follow-up two', 'plain follow-up three'],
          ]);
        }
        if (input.scenarioIndex === 2) {
          return writeStrictUserCatEvidence(input, [
            [strictOutput('scenario two first')],
            [strictOutput('scenario two second')],
          ]);
        }
        return writeStrictUserCatEvidence(input, [
          [strictOutput('scenario three first')],
          [strictOutput('scenario three second'), 'extra explanation after the four lines'],
        ]);
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [
        [strictOutput('replay first')],
        [strictOutput('replay second')],
      ]),
    });

    assert.strictEqual(scorecard.decision, 'unstable');
    assert.deepStrictEqual(scorecard.output_contract_check, {
      declared: true,
      source_ref: 'arena/runs/pipeline-evo-v3-shaped/skills/evo-closeout-v1/SKILL.md',
      expected_turns: 6,
      checked_turns: 6,
      passed_turns: 4,
      violation_count: 2,
      fully_compliant_sessions: 1,
      total_sessions: 3,
      status: 'fail',
    });
    assert.strictEqual(
      (scorecard.cases as any[]).filter(item => item.issue_type === 'output_contract_violation').length,
      2,
    );
    assert.ok((scorecard.replay_results as any[]).every(item => item.output_contract_check.status === 'pass'));
    assert.ok(fs.existsSync(path.join(testRoot, 'arena', 'runs', 'pipeline-evo-v3-shaped', 'arena-run.json')));
  });

  test('fails replay attempts whose fresh turns violate the declared output contract', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-replay'), {
        name: 'strict-replay',
        description: 'Strict output replay skill',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-replay-fail',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-replay-fail',
      scenarioCount: 1,
      maxTurns: 2,
      replayAttempts: 1,
    }, {
      runUserCat: async input => writeStrictUserCatEvidence(input, [
        [strictOutput('initial first')],
        [strictOutput('initial second')],
      ]),
      analyzeLog: async () => JSON.stringify({
        issues: [{
          type: 'tool_failure',
          severity: 'high',
          description: 'independent replay trigger',
          context: 'replay the same input',
        }],
      }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [
        [strictOutput('replay first')],
        ['plain replay output'],
      ]),
    });

    assert.strictEqual((scorecard.output_contract_check as any).status, 'pass');
    assert.strictEqual(scorecard.decision, 'reopened');
    assert.strictEqual((scorecard.replay_attempts as any).fail_count, 1);
    assert.strictEqual((scorecard.replay_results as any[])[0].output_contract_check.status, 'fail');
    assert.strictEqual((scorecard.replay_results as any[])[0].output_contract_check.violation_count, 1);
  });

  test('blocks replay attempts that reuse one native session across fresh runs', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'replay-session-identity'), {
        name: 'replay-session-identity',
        description: 'Replay sessions must be independently traceable.',
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-replay-session-identity',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });
    const sharedSession = 'pet:xiaoba:role-base:shared-replay-session';

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-replay-session-identity',
      scenarioCount: 1,
      maxTurns: 2,
      replayAttempts: 2,
      maxReplayCases: 1,
    }, {
      runUserCat: async input => writeFakeUserCatEvidence(input),
      analyzeLog: async () => JSON.stringify({
        issues: [{
          type: 'tool_failure',
          severity: 'medium',
          description: 'one replayable issue',
          context: 'retry the same task',
        }],
      }),
      runReplay: async input => {
        const report = await writeFakeReplay(input);
        report.session_key = sharedSession;
        const rows = fs.readFileSync(report.fresh_trace_path, 'utf-8')
          .trim()
          .split('\n')
          .map(line => ({ ...JSON.parse(line), session_id: sharedSession }));
        writeJsonl(report.fresh_trace_path, rows);
        return report;
      },
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.strictEqual((scorecard.replay_attempts as any).blocked_count, 2);
    assert.ok((scorecard.replay_results as any[]).every(result => (
      result.trace_identity_check.status === 'blocked'
      && result.notes.some((note: string) => /reused by multiple runs/.test(note))
    )));
  });

  test('blocks trace_id reuse between UserCat and replay sessions in one Arena run', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'cross-phase-trace-identity'), {
        name: 'cross-phase-trace-identity',
        description: 'Trace identities must remain unique across UserCat and replay.',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-cross-phase-trace-identity',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });
    let nativeTraceId = '';

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-cross-phase-trace-identity',
      scenarioCount: 1,
      maxTurns: 1,
      replayAttempts: 1,
      maxReplayCases: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(input, [[strictOutput('native')]], 1);
        const nativeTrace = path.join(
          input.workspaceRoot,
          'logs',
          'sessions',
          'pet',
          '2026-06-30',
          input.usercatRunId,
          'traces.jsonl',
        );
        nativeTraceId = JSON.parse(fs.readFileSync(nativeTrace, 'utf-8').trim()).trace_id;
        return result;
      },
      analyzeLog: async () => JSON.stringify({
        issues: [{
          type: 'tool_failure',
          severity: 'medium',
          description: 'cross-phase replay trigger',
          context: 'retry the same task',
        }],
      }),
      runReplay: async input => {
        const report = await writeFakeReplayWithStrictOutput(input, [[strictOutput('replay')]]);
        const rows = fs.readFileSync(report.fresh_trace_path, 'utf-8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line));
        rows[0].trace_id = nativeTraceId;
        writeJsonl(report.fresh_trace_path, rows);
        return report;
      },
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.strictEqual((scorecard.trace_identity_check as any).status, 'blocked');
    assert.strictEqual((scorecard.replay_attempts as any).blocked_count, 1);
    assert.match((scorecard.replay_results as any[])[0].notes.join('; '), /trace_id .* reused/);
  });

  test('blocks a declared contract when native trace coverage is incomplete', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-incomplete'), {
        name: 'strict-incomplete',
        description: 'Strict output with incomplete evidence',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-incomplete',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-incomplete',
      scenarioCount: 1,
      maxTurns: 2,
      replayAttempts: 1,
    }, {
      runUserCat: async input => writeStrictUserCatEvidence(input, [
        [strictOutput('only persisted turn')],
      ], 2),
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplay(input),
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.deepStrictEqual(scorecard.output_contract_check, {
      declared: true,
      source_ref: 'arena/runs/pipeline-strict-incomplete/skills/strict-incomplete/SKILL.md',
      expected_turns: 2,
      checked_turns: 1,
      passed_turns: 1,
      violation_count: 0,
      fully_compliant_sessions: 0,
      total_sessions: 1,
      status: 'blocked',
    });
  });

  test('blocks duplicate trace ids and turn numbers that only imitate complete coverage', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-duplicate-coverage'), {
        name: 'strict-duplicate-coverage',
        description: 'Strict output with unique trace coverage',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-duplicate-coverage',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-duplicate-coverage',
      scenarioCount: 1,
      maxTurns: 2,
      replayAttempts: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(input, [
          [strictOutput('first')],
          [strictOutput('second')],
        ]);
        const nativeTrace = path.join(
          input.workspaceRoot,
          'logs',
          'sessions',
          'pet',
          '2026-06-30',
          input.usercatRunId,
          'traces.jsonl',
        );
        const rows = fs.readFileSync(nativeTrace, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
        rows[1].trace_id = rows[0].trace_id;
        rows[1].turn = rows[0].turn;
        writeJsonl(nativeTrace, rows);
        return result;
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplay(input),
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.strictEqual((scorecard.output_contract_check as any).status, 'blocked');
    const blockedCase = (scorecard.cases as any[]).find(item => item.issue_type === 'trace_identity_blocked');
    assert.match(blockedCase.suspected_root_cause, /unique non-empty trace_id/);
    assert.match(blockedCase.suspected_root_cause, /turn coverage must be exactly 1\.\.2/);
  });

  test('blocks a declared contract when checked turns lack or mismatch subject Skill visibility', async () => {
    const manifest = manager.importLocalSkill({
      skillPath: writeSkill(path.join(testRoot, 'fixtures', 'skills', 'strict-unbound'), {
        name: 'strict-unbound',
        description: 'Strict output without subject visibility evidence',
        arenaOutputLinePrefixes: STRICT_OUTPUT_PREFIXES,
      }),
    });
    manager.prepareCleanRuntime({
      runId: 'pipeline-strict-unbound',
      reviewMode: 'base_skill',
      subjectId: manifest.subject_id,
      sandbox: { engine: 'macos_seatbelt' },
    });

    const scorecard = await runArenaPipelineWorker({
      projectRoot: testRoot,
      runId: 'pipeline-strict-unbound',
      scenarioCount: 2,
      maxTurns: 2,
      replayAttempts: 1,
    }, {
      runUserCat: async input => {
        const result = await writeStrictUserCatEvidence(input, [
          [strictOutput('first')],
          [strictOutput('second')],
        ]);
        const nativeTrace = path.join(
          input.workspaceRoot,
          'logs',
          'sessions',
          'pet',
          '2026-06-30',
          input.usercatRunId,
          'traces.jsonl',
        );
        const rows = fs.readFileSync(nativeTrace, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
        if (input.scenarioIndex === 1) {
          delete rows[0].tool_visibility;
        } else {
          rows[1].tool_visibility = [{
            roleName: 'base',
            activeSkillName: 'different-skill',
            visibleTools: ['send_text'],
            hiddenToolCount: 0,
          }];
        }
        writeJsonl(nativeTrace, rows);
        return result;
      },
      analyzeLog: async () => JSON.stringify({ issues: [] }),
      runReplay: async input => writeFakeReplayWithStrictOutput(input, [
        [strictOutput('replay first')],
        [strictOutput('replay second')],
      ]),
    });

    assert.strictEqual(scorecard.decision, 'blocked');
    assert.strictEqual((scorecard.output_contract_check as any).status, 'blocked');
    const blockedReasons = (scorecard.cases as any[])
      .filter(item => item.issue_type === 'output_contract_blocked')
      .map(item => item.suspected_root_cause)
      .join('\n');
    assert.match(blockedReasons, /missing final tool_visibility for subject skill strict-unbound/);
    assert.match(blockedReasons, /activeSkillName must be strict-unbound; observed different-skill/);
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
    const replayResults = scorecard.replay_results as any[];
    assert.deepStrictEqual(replayResults.map(result => result.case_id), (scorecard.replay_attempts as any).case_ids);
    assert.deepStrictEqual(
      replayResults.map(result => result.source_trace_ref),
      (scorecard.replay_attempts as any).source_trace_refs,
    );
    assert.ok(replayResults.every((result, index) => (
      result.case_id === replayInputs[index].caseId
      && path.resolve(testRoot, result.source_trace_ref) === path.resolve(replayInputs[index].tracePath)
    )));
    const runIndex = JSON.parse(fs.readFileSync(
      path.join(testRoot, 'arena', 'runs', 'pipeline-case', 'arena-run.json'),
      'utf-8',
    ));
    assert.deepStrictEqual(runIndex.replay_attempts, scorecard.replay_attempts);
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
  const sessionKey = `pet:xiaoba:role-${input.targetRole}:usercat-simulation-${input.usercatRunId}`;
  writeJsonl(nativeTrace, input.messages.map((message, index) => ({
      entry_type: 'trace',
      trace_id: `${input.usercatRunId}.trace.${index + 1}`,
      trace_index: index + 1,
      timestamp: '2026-06-30T00:00:00.000Z',
      session_id: sessionKey,
      session_type: 'pet',
      turn: index + 1,
      user: { text: message },
      assistant: { text: 'done with evidence' },
      tokens: { prompt: 1, completion: 1 },
      metadata: { token: 'usage counter only' },
    })));
  return [
    'user_trace_run: status=completed',
    `run_id=${input.usercatRunId}`,
    `target_role=${input.targetRole}`,
    `session_key=${sessionKey}`,
    `turn_count=${input.messages.length}`,
    `trace=${path.relative(input.workspaceRoot, rawTrace)}`,
    `candidate_dir=${path.relative(input.workspaceRoot, candidateDir)}`,
    `candidate_case=${path.relative(input.workspaceRoot, path.join(candidateDir, 'candidate-case.json'))}`,
  ].join('\n');
}

async function writeStrictUserCatEvidence(
  input: ArenaUserCatStageInput,
  turnDeliveries: string[][],
  reportedTurnCount: number = turnDeliveries.length,
  sessionKeyOverride?: string,
): Promise<string> {
  const rawTrace = path.join(input.workspaceRoot, 'data', 'user-cat', 'traces', input.usercatRunId, 'trace.jsonl');
  const candidateDir = path.join(input.workspaceRoot, 'output', 'user-cat', 'candidates', input.usercatRunId);
  const nativeTrace = path.join(input.workspaceRoot, 'logs', 'sessions', 'pet', '2026-06-30', input.usercatRunId, 'traces.jsonl');
  const sessionKey = sessionKeyOverride
    || `pet:xiaoba:role-${input.targetRole}:usercat-simulation-${input.usercatRunId}`;
  writeJsonl(rawTrace, [
    { type: 'run_start', run_id: input.usercatRunId },
    ...turnDeliveries.flatMap((deliveries, index) => [
      { type: 'user_turn', turn_index: index + 1, text: input.messages[index] || `message ${index + 1}` },
      { type: 'assistant_turn', turn_index: index + 1, text: deliveries.join('') },
    ]),
  ]);
  writeJson(path.join(candidateDir, 'manifest.json'), {
    version: 1,
    run_id: input.usercatRunId,
    target_role: input.targetRole,
    session_key: sessionKey,
    turn_count: reportedTurnCount,
    trace_path: path.relative(input.workspaceRoot, rawTrace),
  });
  writeJsonl(nativeTrace, turnDeliveries.map((deliveries, index) => strictNativeTraceRow({
    traceId: `${input.usercatRunId}.trace.${index + 1}`,
    sessionKey,
    turn: index + 1,
    userText: input.messages[index] || `message ${index + 1}`,
    deliveries,
    activeSkillName: input.runtime.target_profile.subject_skill_id,
  })));
  return [
    'user_trace_run: status=completed',
    `run_id=${input.usercatRunId}`,
    `target_role=${input.targetRole}`,
    `session_key=${sessionKey}`,
    `turn_count=${reportedTurnCount}`,
    `trace=${path.relative(input.workspaceRoot, rawTrace)}`,
    `candidate_dir=${path.relative(input.workspaceRoot, candidateDir)}`,
    `candidate_case=${path.relative(input.workspaceRoot, path.join(candidateDir, 'candidate-case.json'))}`,
  ].join('\n');
}

async function writeFakeReplayWithStrictOutput(
  input: ArenaReplayStageInput,
  turnDeliveries: string[][],
): Promise<TraceReplayReport> {
  const report = await writeFakeReplay(input);
  report.replayed_turns = turnDeliveries.length;
  report.session_key = `pet:xiaoba:role-${input.targetRole}:strict-replay-${input.attemptIndex}`;
  writeJsonl(report.fresh_trace_path, turnDeliveries.map((deliveries, index) => strictNativeTraceRow({
    traceId: `strict-replay-${input.attemptIndex}.${index + 1}`,
    sessionKey: report.session_key,
    turn: index + 1,
    userText: index === 0 ? '帮我看' : '证据在哪',
    deliveries,
    activeSkillName: input.runtime.target_profile.subject_skill_id,
  })));
  return report;
}

function strictNativeTraceRow(input: {
  traceId: string;
  sessionKey: string;
  turn: number;
  userText: string;
  deliveries: string[];
  activeSkillName?: string;
}): Record<string, unknown> {
  return {
    entry_type: 'trace',
    trace_id: input.traceId,
    trace_index: input.turn,
    timestamp: '2026-06-30T00:00:00.000Z',
    session_id: input.sessionKey,
    session_type: 'pet',
    turn: input.turn,
    user: { text: input.userText },
    tool_visibility: [{
      roleName: 'base',
      ...(input.activeSkillName && { activeSkillName: input.activeSkillName }),
      visibleTools: ['send_text'],
      hiddenToolCount: 0,
    }],
    assistant: {
      text: '',
      tool_calls: input.deliveries.map((text, index) => ({
        id: `${input.traceId}.send-${index + 1}`,
        name: 'send_text',
        arguments: { text },
        result: '已发送',
        status: 'success',
        delivery_evidence: [{
          surface: 'pet',
          status: 'delivered',
          delivery_type: 'text',
          timestamp: '2026-06-30T00:00:00.000Z',
          text_preview: text,
        }],
      })),
    },
  };
}

function strictOutput(label: string): string {
  return [
    `MEOW_RESULT::${label}`,
    'MEOW_EVIDENCE::evidence',
    'MEOW_RISK::risk',
    'MEOW_NEXT::next',
  ].join('\n');
}

async function writeFakeReplay(input: ArenaReplayStageInput): Promise<TraceReplayReport> {
  const outDir = input.replayOutDir;
  const replayResultsPath = path.join(outDir, 'replay-results.json');
  const freshTracePath = path.join(outDir, 'fresh-trace.jsonl');
  writeJson(replayResultsPath, { status: 'pass', attempt: input.attemptIndex });
  writeJson(path.join(outDir, 'manifest.json'), { attempt: input.attemptIndex });
  const sessionKey = `pet:xiaoba:role-${input.targetRole}:fake-${input.attemptIndex}`;
  writeJsonl(freshTracePath, ['帮我看', '证据在哪'].map((text, index) => ({
      entry_type: 'trace',
      trace_id: `replay-${input.attemptIndex}.${index + 1}`,
      trace_index: index + 1,
      timestamp: '2026-06-30T00:00:00.000Z',
      session_id: sessionKey,
      session_type: 'pet',
      turn: index + 1,
      user: { text },
      assistant: { text: 'ok' },
    })));
  return {
    replay_version: '0.1',
    run_id: `fake-replay-${input.attemptIndex}`,
    generated_at: '2026-06-30T00:00:00.000Z',
    input_trace_path: input.tracePath,
    out_dir: outDir,
    pet_id: 'xiaoba',
    session_key: sessionKey,
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
  input: { name: string; description: string; arenaOutputLinePrefixes?: string[] },
): string {
  fs.mkdirSync(dirPath, { recursive: true });
  const skillPath = path.join(dirPath, 'SKILL.md');
  fs.writeFileSync(skillPath, [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    ...(input.arenaOutputLinePrefixes ? [
      'arena-output-line-prefixes:',
      ...input.arenaOutputLinePrefixes.map(prefix => `  - ${JSON.stringify(prefix)}`),
    ] : []),
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
