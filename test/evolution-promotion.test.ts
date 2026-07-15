import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ArenaManager,
  buildArenaTargetProfile,
  fingerprintArenaDirectory,
} from '../src/arena/arena-manager';
import { promoteEvolutionCandidate } from '../src/arena/evolution-promotion';
import { runEvolutionDag } from '../src/roles/evolution-cat/evolution-dag';
import { extractTraceReplayInputs } from '../src/replay/trace-replay-runner';
import { SkillParser } from '../src/skills/skill-parser';

const DATE = '2026-07-15';

describe('evidence-bound evolution promotion', () => {
  let root: string;
  let previousArena: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-evolution-promote-'));
    previousArena = process.env.XIAOBA_ARENA;
    delete process.env.XIAOBA_ARENA;
  });

  afterEach(() => {
    if (previousArena === undefined) delete process.env.XIAOBA_ARENA;
    else process.env.XIAOBA_ARENA = previousArena;
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const type of ['skill', 'role'] as const) {
    test(`promotes the exact immutable Arena-passed ${type} and records provenance`, () => {
      const fixture = writePassedEvolution(root, type, `${type}-closeout`);
      const first = promoteEvolutionCandidate({
        workingDirectory: root,
        targetDate: DATE,
        confirmName: fixture.name,
        now: () => new Date('2026-07-15T12:00:00.000Z'),
      });

      assert.equal(first.status, 'promoted');
      assert.equal(first.subject_id, fixture.subjectId);
      assert.equal(first.subject_fingerprint, fixture.fingerprint);
      const production = path.join(root, type === 'skill' ? 'skills' : 'roles', fixture.name);
      assert.equal(fs.existsSync(production), true);
      assert.equal(readStatus(fixture.candidateRoot, type), 'candidate');
      assert.equal(readStatus(fixture.snapshotRoot, type), 'candidate');
      assert.equal(readStatus(production, type), 'active');

      const receiptPath = path.join(fixture.runRoot, 'promotion.json');
      const receipt = readJson(receiptPath);
      assert.equal(receipt.state, 'promoted');
      assert.deepEqual(receipt.authority, { kind: 'explicit_cli', confirmed_name: fixture.name });
      assert.equal(receipt.evidence.subject_id, fixture.subjectId);
      assert.equal(receipt.evidence.subject_fingerprint, fixture.fingerprint);
      assert.match(receipt.production.fingerprint, /^[a-f0-9]{64}$/);
      for (const hash of Object.values(receipt.evidence.sha256)) {
        assert.match(String(hash), /^[a-f0-9]{64}$/);
      }
      assert.deepEqual(Object.keys(receipt.evidence.raw_sha256), [
        relative(root, fixture.arenaRunnerPath),
        relative(root, fixture.arenaTraceA),
        relative(root, fixture.arenaTraceB),
        relative(root, fixture.inspectorCasesPath),
        relative(root, fixture.sourceA),
        relative(root, fixture.sourceB),
      ].sort());
      for (const hash of Object.values(receipt.evidence.raw_sha256)) {
        assert.match(String(hash), /^[a-f0-9]{64}$/);
      }
      assert.equal(
        readJson(fixture.dagPath).terminal.promotion_ref,
        `output/evolution/sleep/${DATE}/promotion.json`,
      );
      assert.deepEqual(readJson(fixture.arenaRunPath).promotion, {
        status: 'promoted',
        production_ref: `${type === 'skill' ? 'skills' : 'roles'}/${fixture.name}`,
        receipt_ref: `output/evolution/sleep/${DATE}/promotion.json`,
      });

      const before = fs.readFileSync(receiptPath, 'utf-8');
      const second = promoteEvolutionCandidate({
        workingDirectory: root,
        targetDate: DATE,
        confirmName: fixture.name,
        now: () => new Date('2026-07-16T12:00:00.000Z'),
      });
      assert.equal(second.status, 'already_promoted');
      assert.equal(fs.readFileSync(receiptPath, 'utf-8'), before);
    });
  }

  test('promotes a Role only when its snapshot-derived native tool profile matches exactly', () => {
    const fixture = writePassedEvolution(root, 'role', 'engineer-cat', {
      baseToolDenylist: ['write_file'],
    });
    const profile = readJson(fixture.arenaRunPath).target_profile;
    assert.ok(profile.registered_tools.includes('write_file'));
    assert.ok(profile.registered_tools.includes('engineer_task_run'));
    assert.ok(profile.provider_visible_tools.includes('engineer_task_run'));
    assert.ok(profile.provider_visible_tools.includes('send_text'));
    assert.ok(!profile.provider_visible_tools.includes('write_file'));

    for (const profileOwner of [fixture.scorecardPath, fixture.arenaRunPath]) {
      updateJson(profileOwner, value => ({
        ...value,
        target_profile: {
          ...value.target_profile,
          registered_tools: value.target_profile.registered_tools
            .filter((tool: string) => tool !== 'engineer_task_run'),
          provider_visible_tools: value.target_profile.provider_visible_tools
            .filter((tool: string) => tool !== 'engineer_task_run'),
        },
      }));
    }
    assert.throws(
      () => promoteEvolutionCandidate({
        workingDirectory: root,
        targetDate: DATE,
        confirmName: fixture.name,
      }),
      /does not exactly match the immutable clean Pet runtime profile/,
    );
    for (const profileOwner of [fixture.scorecardPath, fixture.arenaRunPath]) {
      updateJson(profileOwner, value => ({ ...value, target_profile: profile }));
    }

    const result = promoteEvolutionCandidate({
      workingDirectory: root,
      targetDate: DATE,
      confirmName: fixture.name,
    });
    assert.equal(result.status, 'promoted');
    assert.equal(readStatus(path.join(root, 'roles', fixture.name), 'role'), 'active');
  });

  test('rejects confirmation, subject, fingerprint, and target-profile mismatches', () => {
    writePassedEvolution(root, 'skill', 'confirm-guard');
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: 'other' }),
      /--confirm must exactly equal Candidate name/,
    );

    const cases: Array<[string, (fixture: Fixture) => void, RegExp]> = [
      ['subject', fixture => updateJson(fixture.arenaResultPath, value => ({ ...value, subject_id: 'skill-other' })), /scorecard|subject|manifest/i],
      ['fingerprint', fixture => updateJson(fixture.arenaResultPath, value => ({ ...value, subject_fingerprint: 'a'.repeat(64) })), /fingerprint|manifest|canonical/i],
      ['profile', fixture => updateJson(fixture.scorecardPath, value => ({
        ...value,
        target_profile: { active_role_id: 'base', subject_skill_id: 'different' },
      })), /target[_ ]profile|loaded_skills/],
    ];
    for (const [suffix, mutate, expected] of cases) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-promote-mismatch-${suffix}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `guard-${suffix}`);
        mutate(fixture);
        assert.throws(
          () => promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: fixture.name }),
          expected,
        );
        assert.equal(fs.existsSync(path.join(isolated, 'skills', fixture.name)), false);
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  test('rejects legacy, mismatched, and incomplete output-contract attestations', () => {
    const cases: Array<[string, (fixture: Fixture) => void, RegExp]> = [
      ['legacy', fixture => updateJson(fixture.scorecardPath, value => {
        const { output_contract_check: _removed, ...legacy } = value;
        return legacy;
      }), /output_contract_check/],
      ['undeclared-bypass', fixture => updateJson(fixture.scorecardPath, value => ({
        ...value,
        output_contract_check: {
          declared: false,
          source_ref: null,
          expected_turns: 0,
          checked_turns: 0,
          passed_turns: 0,
          violation_count: 0,
          fully_compliant_sessions: 0,
          total_sessions: 2,
          status: 'not_declared',
        },
      })), /does not match the evaluated Candidate declaration/],
      ['partial', fixture => updateJson(fixture.scorecardPath, value => ({
        ...value,
        output_contract_check: {
          ...value.output_contract_check,
          passed_turns: 5,
          violation_count: 1,
        },
      })), /not fully compliant/],
      ['wrong-prefix-source', fixture => {
        fs.writeFileSync(
          fixture.outputContractSourcePath,
          fs.readFileSync(fixture.outputContractSourcePath, 'utf-8').replace('RESULT::', 'WRONG::'),
          'utf-8',
        );
      }, /does not exactly match/],
    ];
    for (const [suffix, mutate, expected] of cases) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-promote-attestation-${suffix}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `format-${suffix}`);
        mutate(fixture);
        assert.throws(
          () => promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: fixture.name }),
          expected,
        );
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  test('rejects an existing unmanaged target and Arena self-promotion', () => {
    const fixture = writePassedEvolution(root, 'skill', 'existing-guard');
    const target = path.join(root, 'skills', fixture.name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), '# unmanaged\n', 'utf-8');
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /already exists without this receipt/,
    );
    fs.rmSync(target, { recursive: true, force: true });

    process.env.XIAOBA_ARENA = '1';
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /forbidden inside an Arena runtime/,
    );
  });

  test('rederives the content-addressed subject id instead of trusting synchronized manifests', () => {
    const fixture = writePassedEvolution(root, 'skill', 'content-address-guard');
    for (const skillFile of [
      path.join(fixture.candidateRoot, 'SKILL.md'),
      path.join(fixture.snapshotRoot, 'SKILL.md'),
    ]) {
      fs.appendFileSync(skillFile, '\nUnevaluated replacement body.\n', 'utf-8');
    }
    const replacementFingerprint = fingerprintArenaDirectory(fixture.snapshotRoot);
    updateJson(fixture.subjectManifestPath, value => ({ ...value, fingerprint: replacementFingerprint }));
    updateJson(fixture.arenaResultPath, value => ({
      ...value,
      subject_fingerprint: replacementFingerprint,
    }));

    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /subject_id is not canonical/,
    );
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
  });

  test('rejects a top-level pass when any replay or replay contract is not a complete pass', () => {
    const fixture = writePassedEvolution(root, 'skill', 'replay-guard');
    addPassedReplay(root, fixture);
    updateJson(fixture.scorecardPath, value => ({
      ...value,
      replay_results: value.replay_results.map((result: any) => ({
        ...result,
        output_contract_check: {
          ...result.output_contract_check,
          passed_turns: result.output_contract_check.passed_turns - 1,
          violation_count: 1,
          fully_compliant_sessions: 0,
          status: 'fail',
        },
      })),
    }));

    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /strict output contract did not fully pass/,
    );
  });

  test('rejects replay attempt counts that do not match the retained replay results', () => {
    const fixture = writePassedEvolution(root, 'skill', 'replay-count-guard');
    const attempts = {
      planned: 1,
      completed: 1,
      pass_count: 1,
      fail_count: 0,
      blocked_count: 0,
      trace_refs: [],
    };
    updateJson(fixture.arenaRunPath, value => ({ ...value, replay_attempts: attempts }));
    updateJson(fixture.scorecardPath, value => ({
      ...value,
      replay_attempts: attempts,
      replay_results: [],
    }));
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /deterministic selection from retained Inspector cases/,
    );
  });

  test('recomputes Arena decision semantics instead of promoting a pass with actionable replay cases', () => {
    const fixture = writePassedEvolution(root, 'skill', 'decision-semantics-guard');
    addPassedReplay(root, fixture);
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /Arena decision does not match retained Inspector cases and replay outcomes: expected unstable/,
    );
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
  });

  test('rejects noncanonical, ambiguous, or drifted replay selector config', () => {
    const attacks: Array<[
      string,
      (fixture: Fixture) => void,
      RegExp,
    ]> = [
      [
        'zero-profile-limit',
        fixture => updateJson(fixture.scorecardPath, value => ({
          ...value,
          arena_eval_profile: { ...value.arena_eval_profile, max_replay_cases: 0 },
        })),
        /max_replay_cases must be a positive integer/,
      ],
      [
        'runner-profile-drift',
        fixture => updateJson(fixture.scorecardPath, value => ({
          ...value,
          arena_eval_profile: { ...value.arena_eval_profile, max_replay_cases: 1 },
        })),
        /profile config does not match the canonical Arena runner command/,
      ],
      [
        'duplicate-runner-flag',
        fixture => updateJson(fixture.arenaRunnerPath, value => ({
          ...value,
          worker_command: [...value.worker_command, '--max-replay-cases', '1'],
        })),
        /--max-replay-cases must be one canonical positive integer/,
      ],
      [
        'malformed-runner-flag',
        fixture => updateJson(fixture.arenaRunnerPath, value => {
          const command = [...value.worker_command];
          command[command.indexOf('--max-replay-cases') + 1] = '01';
          return { ...value, worker_command: command };
        }),
        /--max-replay-cases must be one canonical positive integer/,
      ],
      [
        'counter-drift',
        fixture => updateJson(fixture.scorecardPath, value => ({
          ...value,
          arena_eval_profile: {
            ...value.arena_eval_profile,
            inspector_case_count: value.arena_eval_profile.inspector_case_count + 1,
          },
        })),
        /profile counters do not match deterministic Inspector case selection/,
      ],
    ];
    for (const [name, attack, expected] of attacks) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-replay-config-${name}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `replay-config-${name}`);
        attack(fixture);
        assert.throws(
          () => promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: fixture.name }),
          expected,
        );
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  test('rejects escaped, nonregular, symlinked, or unbound Inspector cases artifacts', () => {
    const attacks: Array<[string, (fixture: Fixture) => void, RegExp]> = [
      [
        'unbound-run-ref',
        fixture => updateJson(fixture.arenaRunPath, value => ({ ...value, inspector_refs: [] })),
        /inspector_refs must bind exactly the canonical retained Inspector cases artifact/,
      ],
      [
        'escaped-scorecard-ref',
        fixture => updateJson(fixture.scorecardPath, value => ({
          ...value,
          debug_refs: { ...value.debug_refs, inspector_cases: '../escaped-inspector-cases.json' },
        })),
        /Inspector cases artifact escapes the project root/,
      ],
      [
        'nonregular-artifact',
        fixture => {
          fs.rmSync(fixture.inspectorCasesPath);
          fs.mkdirSync(fixture.inspectorCasesPath);
        },
        /Inspector cases artifact must be an existing regular file/,
      ],
    ];
    if (process.platform !== 'win32') {
      attacks.push([
        'symlinked-artifact',
        fixture => {
          const copy = path.join(fixture.runRoot, 'inspector-cases-copy.json');
          fs.copyFileSync(fixture.inspectorCasesPath, copy);
          fs.unlinkSync(fixture.inspectorCasesPath);
          fs.symlinkSync(copy, fixture.inspectorCasesPath);
        },
        /Inspector cases artifact must be an existing regular file/,
      ]);
    }
    for (const [name, attack, expected] of attacks) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-inspector-artifact-${name}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `inspector-artifact-${name}`);
        attack(fixture);
        assert.throws(
          () => promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: fixture.name }),
          expected,
        );
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  test('proves two independent root session lineages from digest-bound raw trace rows', () => {
    const fixture = writePassedEvolution(root, 'skill', 'lineage-guard');
    writeFile(fixture.sourceA, [
      traceRow('trace-a', 'same-root-session'),
      traceRow('trace-b', 'same-root-session'),
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const refs = [
      `${relative(root, fixture.sourceA)}#trace-a`,
      `${relative(root, fixture.sourceA)}#trace-b`,
    ];
    updateJson(fixture.digestPath, value => ({
      ...value,
      observations: [
        { trace_id: 'trace-a', trace_ref: refs[0], session_id: 'same-root-session' },
        { trace_id: 'trace-b', trace_ref: refs[1], session_id: 'same-root-session' },
      ],
    }));
    updateJson(fixture.inspectorPath, value => ({ ...value, evidence_refs: refs }));
    updateJson(fixture.candidateDecisionPath, value => ({ ...value, evidence_refs: refs }));

    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /two independent root session lineages/,
    );
  });

  test('rejects smuggled Base skills and Role profile/manifest drift', () => {
    const skillFixture = writePassedEvolution(root, 'skill', 'profile-guard');
    for (const profileOwner of [skillFixture.scorecardPath, skillFixture.arenaRunPath]) {
      updateJson(profileOwner, value => ({
        ...value,
        target_profile: {
          ...value.target_profile,
          loaded_skills: [skillFixture.name, 'smuggled-default'],
        },
      }));
    }
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: skillFixture.name }),
      /zero-default Base/,
    );

    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-role-profile-guard-'));
    try {
      const roleFixture = writePassedEvolution(isolated, 'role', 'role-profile-guard');
      updateJson(roleFixture.subjectManifestPath, value => ({
        ...value,
        role: { ...value.role, local_skills: ['ghost-skill'] },
      }));
      assert.throws(
        () => promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: roleFixture.name }),
        /Role subject manifest and clean runtime profile/,
      );
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });

  test('re-attests raw native and replay traces before promotion', () => {
    for (const kind of ['native', 'replay'] as const) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-promote-raw-${kind}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `raw-${kind}-guard`);
        const replay = addPassedReplay(isolated, fixture);
        const target = kind === 'native' ? fixture.arenaTraceA : replay.freshTrace;
        const rows = fs.readFileSync(target, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
        rows[0].session_id = 'pet:xiaoba:tampered-session';
        writeJsonl(target, rows);
        assert.throws(
          () => promoteEvolutionCandidate({
            workingDirectory: isolated,
            targetDate: DATE,
            confirmName: fixture.name,
          }),
          kind === 'native'
            ? /native trace identity check does not exactly match/
            : /Replay result 1 identity check does not exactly match/,
        );
        assert.equal(fs.existsSync(path.join(isolated, 'skills', fixture.name)), false);
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  test('rechecks every strict output turn from raw evidence before promotion', () => {
    const fixture = writePassedEvolution(root, 'skill', 'raw-output-guard');
    const rows = fs.readFileSync(fixture.arenaTraceB, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    rows[1].assistant.tool_calls[0].arguments.text = 'undeclared one-line output';
    writeJsonl(fixture.arenaTraceB, rows);
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /output-contract check does not exactly match the raw UserCat traces/,
    );
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
  });

  test('rejects trace_id reuse across independent Arena sessions before promotion', () => {
    const fixture = writePassedEvolution(root, 'skill', 'global-trace-id-guard');
    const firstTraceId = JSON.parse(fs.readFileSync(fixture.arenaTraceA, 'utf-8').trim().split('\n')[0]).trace_id;
    const rows = fs.readFileSync(fixture.arenaTraceB, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    rows[0].trace_id = firstTraceId;
    writeJsonl(fixture.arenaTraceB, rows);
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /native trace identity check does not exactly match/,
    );
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
  });

  test('rejects trace_id reuse between UserCat and replay sessions before promotion', () => {
    const fixture = writePassedEvolution(root, 'skill', 'cross-phase-trace-id-guard');
    const replay = addPassedReplay(root, fixture);
    const nativeTraceId = JSON.parse(fs.readFileSync(fixture.arenaTraceA, 'utf-8').trim().split('\n')[0]).trace_id;
    const rows = fs.readFileSync(replay.freshTrace, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    rows[0].trace_id = nativeTraceId;
    writeJsonl(replay.freshTrace, rows);
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /trace_id values must be globally unique/,
    );
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
  });

  test('rejects semantically tampered retained replay artifacts', () => {
    const attacks: Array<[string, (replay: ReturnType<typeof addPassedReplay>) => void, RegExp]> = [
      ['manifest', replay => updateJson(replay.manifest, value => ({ ...value, session_key: 'forged-session' })), /manifest does not match/],
      ['result', replay => updateJson(replay.replayResult, value => value.map((item: any, index: number) => (
        index === 0 ? { ...item, ok: false, status: 500, error: 'forged' } : item
      ))), /successful index\/sourceLine-bound replay/],
      ['comparison', replay => updateJson(replay.comparison, value => ({ ...value, userInputsReplayed: false })), /retained inputs do not exactly match/],
      ['inputs', replay => updateJson(replay.inputs, value => value.map((item: any, index: number) => (
        index === 0 ? { ...item, text: 'forged input' } : item
      ))), /extracted-inputs artifact does not exactly match/],
    ];
    for (const [name, attack, expected] of attacks) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-replay-artifact-${name}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `replay-artifact-${name}`);
        const replay = addPassedReplay(isolated, fixture);
        attack(replay);
        assert.throws(
          () => promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: fixture.name }),
          expected,
        );
        assert.equal(fs.existsSync(path.join(isolated, 'skills', fixture.name)), false);
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  test('rejects a fully synchronized replay retarget when retained Inspector cases still name the original task', () => {
    const fixture = writePassedEvolution(root, 'skill', 'replay-retarget-guard');
    const replay = addPassedReplay(root, fixture);
    const easyTrace = path.join(root, 'logs', 'sessions', 'easy', 'traces.jsonl');
    writeJsonl(easyTrace, Array.from({ length: 2 }, (_, index) => promotionArenaTraceRow({
      type: 'skill',
      candidateName: fixture.name,
      traceId: `easy-source-${index + 1}`,
      sessionKey: 'pet:xiaoba:role-base:easy-source',
      turn: index + 1,
    })));
    const easyRef = relative(root, easyTrace);
    const easyCaseId = 'case.forged.easy-source';
    const originalCaseId = `case.evolution-${DATE}-${fixture.name}.replay-source`;
    writeJson(replay.inputs, extractTraceReplayInputs(easyTrace, 2));
    updateJson(replay.manifest, value => ({ ...value, input_trace_path: easyTrace }));
    const forgedAttempts = {
      ...readJson(fixture.scorecardPath).replay_attempts,
      case_ids: [easyCaseId],
      source_trace_refs: [easyRef],
    };
    updateJson(fixture.arenaRunPath, value => ({
      ...value,
      replay_attempts: forgedAttempts,
    }));
    updateJson(fixture.scorecardPath, value => ({
      ...value,
      cases: value.cases.map((item: any) => (
        item.case_id === originalCaseId ? {
          case_id: easyCaseId,
          issue_type: 'tool_failure',
          severity: 'medium',
          evidence_refs: [easyRef],
          suspected_root_cause: 'forged easy source',
          replay_intent: 'replay easy source',
        } : item
      )),
      replay_attempts: forgedAttempts,
      replay_results: value.replay_results.map((result: any) => ({
        ...result,
        case_id: easyCaseId,
        source_trace_ref: easyRef,
      })),
    }));
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /scorecard cases must exactly match the retained Inspector cases artifact/,
    );
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
  });

  test('rejects an easy replay source injected into both Inspector cases and synchronized Arena aggregates', () => {
    const fixture = writePassedEvolution(root, 'skill', 'replay-source-root-guard');
    const replay = addPassedReplay(root, fixture);
    const easyTrace = path.join(root, 'logs', 'sessions', 'easy-injected', 'traces.jsonl');
    writeJsonl(easyTrace, Array.from({ length: 2 }, (_, index) => promotionArenaTraceRow({
      type: 'skill',
      candidateName: fixture.name,
      traceId: `easy-injected-${index + 1}`,
      sessionKey: 'pet:xiaoba:role-base:easy-injected',
      turn: index + 1,
    })));
    const easyRef = relative(root, easyTrace);
    const easyCaseId = 'case.forged.easy-injected';
    const originalCaseId = `case.evolution-${DATE}-${fixture.name}.replay-source`;
    const easyCase = {
      case_id: easyCaseId,
      issue_type: 'tool_failure',
      severity: 'medium',
      evidence_refs: [easyRef],
      suspected_root_cause: 'forged easy source',
      replay_intent: 'replay injected easy source',
    };
    writeJson(replay.inputs, extractTraceReplayInputs(easyTrace, 2));
    updateJson(replay.manifest, value => ({ ...value, input_trace_path: easyTrace }));
    updateJson(fixture.inspectorCasesPath, value => ({
      ...value,
      cases: value.cases.map((item: any) => item.case_id === originalCaseId ? easyCase : item),
    }));
    const forgedAttempts = {
      ...readJson(fixture.scorecardPath).replay_attempts,
      case_ids: [easyCaseId],
      source_trace_refs: [easyRef],
    };
    updateJson(fixture.arenaRunPath, value => ({ ...value, replay_attempts: forgedAttempts }));
    updateJson(fixture.scorecardPath, value => ({
      ...value,
      cases: value.cases.map((item: any) => item.case_id === originalCaseId ? easyCase : item),
      replay_attempts: forgedAttempts,
      replay_results: value.replay_results.map((result: any) => ({
        ...result,
        case_id: easyCaseId,
        source_trace_ref: easyRef,
      })),
    }));

    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /selected replay source must come from the retained Inspector native trace refs/,
    );
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
  });

  test('rejects an output-empty replay for a non-strict Role even when results forge visible text events', () => {
    const fixture = writePassedEvolution(root, 'role', 'empty-replay-role');
    const replay = addPassedReplay(root, fixture);
    const rows = fs.readFileSync(replay.freshTrace, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    for (const row of rows) row.assistant = { text: '', tool_calls: [] };
    writeJsonl(replay.freshTrace, rows);
    updateJson(replay.replayResult, value => value.map((item: any) => ({
      ...item,
      text: '',
      textEventCount: 1,
      visibleToUser: true,
      eventCount: 0,
    })));
    updateJson(replay.comparison, value => ({
      ...value,
      newTrace: {
        ...value.newTrace,
        toolCounts: {},
        deliveryEvidenceCount: 0,
        visibleCompletedCount: 0,
        finalVisibleCount: 0,
        failedTools: [],
      },
    }));
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /does not satisfy the Arena replay pass predicate/,
    );
    assert.equal(fs.existsSync(path.join(root, 'roles', fixture.name)), false);
  });

  test('idempotent promote fails closed when content-addressed native evidence drifts', () => {
    const fixture = writePassedEvolution(root, 'skill', 'idempotent-raw-drift');
    promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name });
    fs.appendFileSync(fixture.arenaTraceA, '\n', 'utf-8');
    assert.throws(
      () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
      /Existing promotion receipt does not match current raw evidence|raw evidence content drifted/,
    );
  });

  test('same-date freeze fails closed when the content-addressed Inspector cases artifact drifts', async () => {
    const fixture = writePassedEvolution(root, 'skill', 'same-date-raw-drift');
    promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name });
    const receipt = readJson(path.join(fixture.runRoot, 'promotion.json'));
    assert.equal(receipt.evidence.raw_sha256[relative(root, fixture.inspectorCasesPath)] !== undefined, true);
    updateJson(fixture.inspectorCasesPath, value => ({ ...value, forged_after_promotion: true }));
    await assert.rejects(
      runEvolutionDag({ workingDirectory: root, targetDate: DATE, minOccurrences: 2 }),
      /EVOLUTION_SAME_DATE_PROMOTION_PROTECTED.*raw evidence.*drifted/i,
    );
    assert.equal(fs.existsSync(path.join(fixture.runRoot, 'promotion.json')), true);
  });

  test('rejects symlinked raw evidence without following its external target', () => {
    if (process.platform === 'win32') return;
    const fixture = writePassedEvolution(root, 'skill', 'raw-symlink-guard');
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-raw-evidence-target-'));
    try {
      const externalTrace = path.join(external, 'trace.jsonl');
      fs.copyFileSync(fixture.arenaTraceA, externalTrace);
      const before = fs.readFileSync(externalTrace, 'utf-8');
      fs.unlinkSync(fixture.arenaTraceA);
      fs.symlinkSync(externalTrace, fixture.arenaTraceA);
      assert.throws(
        () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name }),
        /Arena trace evidence must be an existing regular file/,
      );
      assert.equal(fs.readFileSync(externalTrace, 'utf-8'), before);
      assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), false);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  test('idempotent promotion rejects tampered receipt refs, hashes, and current evidence', () => {
    const attacks: Array<[string, (fixture: Fixture, receiptPath: string) => void]> = [
      ['receipt-ref', (_fixture, receiptPath) => updateJson(receiptPath, value => ({
        ...value,
        evidence: { ...value.evidence, scorecard_ref: 'arena/forged-scorecard.json' },
      }))],
      ['receipt-hash', (_fixture, receiptPath) => updateJson(receiptPath, value => ({
        ...value,
        evidence: {
          ...value.evidence,
          sha256: { ...value.evidence.sha256, arena_scorecard: '0'.repeat(64) },
        },
      }))],
      ['raw-hash-extra', (_fixture, receiptPath) => updateJson(receiptPath, value => ({
        ...value,
        evidence: {
          ...value.evidence,
          raw_sha256: { ...value.evidence.raw_sha256, 'logs/forged.jsonl': '0'.repeat(64) },
        },
      }))],
      ['raw-hash-missing', (_fixture, receiptPath) => updateJson(receiptPath, value => {
        const rawEntries = Object.entries(value.evidence.raw_sha256);
        return {
          ...value,
          evidence: {
            ...value.evidence,
            raw_sha256: Object.fromEntries(rawEntries.slice(1)),
          },
        };
      })],
      ['current-evidence', (fixture) => updateJson(fixture.scorecardPath, value => ({ ...value, forged: true }))],
    ];
    for (const [name, attack] of attacks) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-receipt-${name}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `receipt-${name}`);
        promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: fixture.name });
        const receiptPath = path.join(fixture.runRoot, 'promotion.json');
        attack(fixture, receiptPath);
        assert.throws(
          () => promoteEvolutionCandidate({ workingDirectory: isolated, targetDate: DATE, confirmName: fixture.name }),
          /Existing promotion receipt does not match/,
        );
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  test('rejects existing promotion receipt symlinks without reading or replacing their targets', () => {
    if (process.platform === 'win32') return;
    for (const mode of ['idempotent', 'dangling'] as const) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-receipt-symlink-${mode}-`));
      const external = fs.mkdtempSync(path.join(os.tmpdir(), `xiaoba-receipt-target-${mode}-`));
      try {
        const fixture = writePassedEvolution(isolated, 'skill', `receipt-symlink-${mode}`);
        const receiptPath = path.join(fixture.runRoot, 'promotion.json');
        const externalTarget = path.join(external, 'promotion.json');
        let externalBefore: string | undefined;

        if (mode === 'idempotent') {
          promoteEvolutionCandidate({
            workingDirectory: isolated,
            targetDate: DATE,
            confirmName: fixture.name,
          });
          externalBefore = fs.readFileSync(receiptPath, 'utf-8');
          fs.writeFileSync(externalTarget, externalBefore, 'utf-8');
          fs.unlinkSync(receiptPath);
        }
        fs.symlinkSync(externalTarget, receiptPath);

        assert.throws(
          () => promoteEvolutionCandidate({
            workingDirectory: isolated,
            targetDate: DATE,
            confirmName: fixture.name,
          }),
          /promotion receipt cannot be a symlink/i,
        );
        assert.equal(fs.lstatSync(receiptPath).isSymbolicLink(), true);
        if (externalBefore !== undefined) {
          assert.equal(fs.readFileSync(externalTarget, 'utf-8'), externalBefore);
        } else {
          assert.equal(fs.existsSync(externalTarget), false);
          assert.equal(fs.existsSync(path.join(isolated, 'skills', fixture.name)), false);
        }
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
      }
    }
  });

  test('same-date sleep freezes a promoted run and never orphans its receipt', async () => {
    const fixture = writePassedEvolution(root, 'skill', 'same-date-guard');
    promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name });
    const receiptPath = path.join(fixture.runRoot, 'promotion.json');
    const before = fs.readFileSync(receiptPath, 'utf-8');
    const result = await runEvolutionDag({ workingDirectory: root, targetDate: DATE, minOccurrences: 2 }, {
      buildDigest: () => { throw new Error('promoted same-date run must not harvest again'); },
      runRoleStage: async () => { throw new Error('promoted same-date run must not call a role'); },
      runArena: async () => { throw new Error('promoted same-date run must not rerun Arena'); },
    });
    assert.equal(result.terminal?.promotion_ref, `output/evolution/sleep/${DATE}/promotion.json`);
    assert.equal(fs.readFileSync(receiptPath, 'utf-8'), before);
    assert.equal(fs.existsSync(path.join(root, 'skills', fixture.name)), true);
  });

  test('same-date sleep fails closed without deleting partial promotion evidence', async () => {
    const fixture = writePassedEvolution(root, 'skill', 'partial-promotion-guard');
    const receiptPath = path.join(fixture.runRoot, 'promotion.json');
    writeJson(receiptPath, { version: 1, state: 'prepared' });
    const sentinel = path.join(fixture.runRoot, 'must-survive.txt');
    writeFile(sentinel, 'keep');
    await assert.rejects(
      runEvolutionDag({ workingDirectory: root, targetDate: DATE, minOccurrences: 2 }),
      /EVOLUTION_SAME_DATE_PROMOTION_PROTECTED/,
    );
    assert.equal(fs.readFileSync(sentinel, 'utf-8'), 'keep');
    assert.equal(fs.existsSync(receiptPath), true);
  });

  test('same-date sleep rejects a tampered production capability without deleting provenance', async () => {
    const fixture = writePassedEvolution(root, 'skill', 'tampered-production-guard');
    promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: fixture.name });
    const receiptPath = path.join(fixture.runRoot, 'promotion.json');
    const productionSkill = path.join(root, 'skills', fixture.name, 'SKILL.md');
    fs.appendFileSync(productionSkill, '\nTampered after promotion.\n', 'utf-8');
    await assert.rejects(
      runEvolutionDag({ workingDirectory: root, targetDate: DATE, minOccurrences: 2 }),
      /fingerprint no longer matches/,
    );
    assert.equal(fs.existsSync(receiptPath), true);
    assert.equal(fs.existsSync(fixture.dagPath), true);
  });

  test('rejects output symlink escape before creating the promotion lock', () => {
    if (process.platform === 'win32') return;
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-output-link-target-'));
    try {
      fs.symlinkSync(external, path.join(root, 'output'));
      assert.throws(
        () => promoteEvolutionCandidate({ workingDirectory: root, targetDate: DATE, confirmName: 'anything' }),
        /Promotion output root must be an existing directory/,
      );
      assert.equal(fs.existsSync(path.join(external, 'evolution', '.promote.lock')), false);
      assert.equal(fs.existsSync(path.join(external, 'evolution')), false);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });
});

interface Fixture {
  type: 'skill' | 'role';
  name: string;
  runRoot: string;
  candidateRoot: string;
  snapshotRoot: string;
  subjectId: string;
  fingerprint: string;
  dagPath: string;
  digestPath: string;
  inspectorPath: string;
  candidateDecisionPath: string;
  arenaResultPath: string;
  arenaRunPath: string;
  scorecardPath: string;
  arenaRunnerPath: string;
  inspectorCasesPath: string;
  subjectManifestPath: string;
  outputContractSourcePath: string;
  sourceA: string;
  sourceB: string;
  arenaTraceA: string;
  arenaTraceB: string;
}

function writePassedEvolution(
  root: string,
  type: 'skill' | 'role',
  name: string,
  roleConfig: Record<string, unknown> = {},
): Fixture {
  const runRoot = path.join(root, 'output', 'evolution', 'sleep', DATE);
  const candidateRoot = path.join(runRoot, 'candidates', name);
  writeCandidate(candidateRoot, type, name, roleConfig);

  const manager = new ArenaManager({
    projectRoot: root,
    now: () => new Date('2026-07-15T10:00:00.000Z'),
  });
  const manifest = type === 'skill'
    ? manager.importLocalSkill({ skillPath: candidateRoot })
    : manager.importLocalRole({ rolePath: candidateRoot });
  const snapshotRoot = path.join(root, 'arena', 'subjects', manifest.subject_id, 'source');
  const subjectManifestPath = path.join(root, 'arena', 'subjects', manifest.subject_id, 'arena-manifest.json');
  const runId = `evolution-${DATE}-${name}`;
  const arenaRunPath = path.join(root, 'arena', 'runs', runId, 'arena-run.json');
  const scorecardPath = path.join(root, 'arena', 'runs', runId, 'arena-scorecard.json');
  const outputContractSourcePath = path.join(
    root,
    'arena',
    'runs',
    runId,
    'skills',
    name,
    'SKILL.md',
  );
  const targetProfile = buildArenaTargetProfile({
    reviewMode: type === 'skill' ? 'base_skill' : 'role',
    subject: manifest,
    targetRoleId: type === 'role' ? name : undefined,
    surface: 'pet',
    rolePath: type === 'role' ? snapshotRoot : undefined,
    workingDirectory: path.join(root, 'arena', 'runs', runId, 'workspace'),
  });

  const sourceA = path.join(root, 'logs', 'sessions', 'a', 'traces.jsonl');
  const sourceB = path.join(root, 'logs', 'sessions', 'b', 'traces.jsonl');
  const arenaTraceA = path.join(root, 'arena', 'runs', runId, 'workspace', 'trace-a.jsonl');
  const arenaTraceB = path.join(root, 'arena', 'runs', runId, 'workspace', 'trace-b.jsonl');
  const arenaSessionA = `pet:xiaoba:role-${type === 'skill' ? 'base' : name}:arena-${name}-a`;
  const arenaSessionB = `pet:xiaoba:role-${type === 'skill' ? 'base' : name}:arena-${name}-b`;
  writeTrace(sourceA, 'trace-a', 'root-session-a');
  writeTrace(sourceB, 'trace-b', 'root-session-b');
  writeJsonl(arenaTraceA, Array.from({ length: 3 }, (_, index) => promotionArenaTraceRow({
    type,
    candidateName: name,
    traceId: `arena-${name}-a-${index + 1}`,
    sessionKey: arenaSessionA,
    turn: index + 1,
  })));
  writeJsonl(arenaTraceB, Array.from({ length: 3 }, (_, index) => promotionArenaTraceRow({
    type,
    candidateName: name,
    traceId: `arena-${name}-b-${index + 1}`,
    sessionKey: arenaSessionB,
    turn: index + 1,
  })));
  if (type === 'skill') {
    writeFile(
      outputContractSourcePath,
      fs.readFileSync(path.join(snapshotRoot, 'SKILL.md'), 'utf-8'),
    );
  }

  const arenaRunnerPath = path.join(root, 'arena', 'runs', runId, 'arena-runner.json');
  const inspectorCasesPath = path.join(root, 'arena', 'runs', runId, 'debug', 'inspector-cases.json');
  const inspectorCases = [
    {
      case_id: `case.${runId}.scenario-1.baseline`,
      issue_type: 'no_issue_found',
      severity: 'low',
      evidence_refs: [relative(root, arenaTraceA)],
      suspected_root_cause: 'no high-signal issue found in the first trace',
      replay_intent: 'Replay the same low-information multi-turn interaction to check stability.',
    },
    {
      case_id: `case.${runId}.scenario-2.baseline`,
      issue_type: 'no_issue_found',
      severity: 'low',
      evidence_refs: [relative(root, arenaTraceB)],
      suspected_root_cause: 'no high-signal issue found in the second trace',
      replay_intent: 'Replay the same low-information multi-turn interaction to check stability.',
    },
  ];
  writeJson(inspectorCasesPath, {
    version: 1,
    run_id: runId,
    inspector_role: 'inspector-cat',
    trace_refs: [relative(root, arenaTraceA), relative(root, arenaTraceB)],
    case_count: inspectorCases.length,
    cases: inspectorCases,
    generated_at: '2026-07-15T10:15:00.000Z',
  });
  writeJson(arenaRunnerPath, {
    version: 1,
    run_id: runId,
    worker_command: [
      process.execPath,
      path.join(root, 'dist', 'index.js'),
      'arena',
      'run',
      'worker',
      '--run-id',
      runId,
      '--timeout-ms',
      '600000',
      '--scenario-count',
      '2',
      '--replay-attempts',
      '1',
      '--max-replay-cases',
      '2',
    ],
  });
  const arenaEvalProfile = {
    profile: 'normal',
    scenario_count: 2,
    max_usercat_turns: 3,
    replay_attempts_per_case: 1,
    replay_case_count: 0,
    inspector_case_count: inspectorCases.length,
    replay_candidate_case_count: 0,
    max_replay_cases: 2,
    skipped_replay_case_count: 0,
    planned_replay_attempts: 0,
  };

  writeJson(arenaRunPath, {
    version: 1,
    run_id: runId,
    review_mode: type === 'skill' ? 'base_skill' : 'role',
    subject_id: manifest.subject_id,
    subject_manifest_path: `arena/subjects/${manifest.subject_id}/arena-manifest.json`,
    target_profile: targetProfile,
    decision: 'pass',
    inspector_refs: [relative(root, inspectorCasesPath)],
    replay_attempts: {
      planned: 0,
      completed: 0,
      pass_count: 0,
      fail_count: 0,
      blocked_count: 0,
      trace_refs: [],
    },
    promotion: {},
  });
  const outputContract = type === 'skill'
    ? {
      declared: true,
      source_ref: relative(root, outputContractSourcePath),
      expected_turns: 6,
      checked_turns: 6,
      passed_turns: 6,
      violation_count: 0,
      fully_compliant_sessions: 2,
      total_sessions: 2,
      status: 'pass',
    }
    : {
      declared: false,
      source_ref: null,
      expected_turns: 0,
      checked_turns: 0,
      passed_turns: 0,
      violation_count: 0,
      fully_compliant_sessions: 0,
      total_sessions: 2,
      status: 'not_declared',
    };
  writeJson(scorecardPath, {
    version: 1,
    scorecard_type: 'arena',
    arena_run_id: runId,
    subject_id: manifest.subject_id,
    decision: 'pass',
    review_mode: type === 'skill' ? 'base_skill' : 'role',
    target_profile: targetProfile,
    stages: {
      usercat: { status: 'pass' },
      inspector: { status: 'pass' },
      reviewer: { status: 'pass' },
    },
    usercat_runs: [
      {
        index: 1,
        status: 'pass',
        run_id: `${runId}-usercat-1`,
        session_key: arenaSessionA,
        turn_count: 3,
      },
      {
        index: 2,
        status: 'pass',
        run_id: `${runId}-usercat-2`,
        session_key: arenaSessionB,
        turn_count: 3,
      },
    ],
    trace_identity_check: {
      expected_sessions: 2,
      verified_sessions: 2,
      expected_turns: 6,
      checked_turns: 6,
      status: 'pass',
    },
    output_contract_check: outputContract,
    cases: inspectorCases,
    replay_attempts: {
      planned: 0,
      completed: 0,
      pass_count: 0,
      fail_count: 0,
      blocked_count: 0,
      trace_refs: [],
    },
    replay_results: [],
    arena_eval_profile: arenaEvalProfile,
    evidence: {
      trace_refs: [relative(root, arenaTraceA), relative(root, arenaTraceB)],
      arena_run: relative(root, arenaRunPath),
    },
    debug_refs: {
      inspector_cases: relative(root, inspectorCasesPath),
    },
  });

  const inspectorPath = path.join(runRoot, 'inspector-route.json');
  const digestPath = path.join(runRoot, 'digest.json');
  const candidateDecisionPath = path.join(runRoot, 'evolution-candidate.json');
  const arenaResultPath = path.join(runRoot, 'arena-result.json');
  const dagPath = path.join(runRoot, 'dag-run.json');
  writeJson(digestPath, {
    schema_version: 1,
    run_id: `sleep-${DATE}`,
    source: 'xiaoba_session_log_v3',
    window: { target_date: DATE },
    observations: [
      { trace_id: 'trace-a', trace_ref: `${relative(root, sourceA)}#trace-a`, session_id: 'root-session-a' },
      { trace_id: 'trace-b', trace_ref: `${relative(root, sourceB)}#trace-b`, session_id: 'root-session-b' },
    ],
  });
  writeJson(inspectorPath, {
    version: 1,
    route: 'evolution',
    summary: 'Repeated capability gap',
    finding_refs: ['pattern:repeated'],
    evidence_refs: [`${relative(root, sourceA)}#trace-a`, `${relative(root, sourceB)}#trace-b`],
  });
  writeJson(candidateDecisionPath, {
    version: 1,
    status: 'candidate',
    summary: 'Candidate produced',
    evidence_refs: [`${relative(root, sourceA)}#trace-a`, `${relative(root, sourceB)}#trace-b`],
    candidate: {
      type,
      name,
      path: `candidates/${name}${type === 'skill' ? '/SKILL.md' : ''}`,
    },
  });
  writeJson(arenaResultPath, {
    run_id: runId,
    decision: 'pass',
    scorecard_ref: relative(root, scorecardPath),
    subject_id: manifest.subject_id,
    subject_manifest_ref: `arena/subjects/${manifest.subject_id}/arena-manifest.json`,
    subject_fingerprint: manifest.fingerprint,
  });
  writeJson(dagPath, {
    version: 1,
    run_id: `evolution-dag-${DATE}`,
    target_date: DATE,
    status: 'completed',
    route: 'evolution',
    digest_ref: relative(root, digestPath),
    inspector_ref: relative(root, inspectorPath),
    stages: [
      { name: 'harvest', status: 'completed', output_ref: relative(root, digestPath) },
      { name: 'inspector', status: 'completed', output_ref: relative(root, inspectorPath) },
      { name: 'evolution', status: 'completed', output_ref: relative(root, candidateDecisionPath) },
      { name: 'arena', status: 'completed', output_ref: relative(root, arenaResultPath) },
    ],
    terminal: {
      status: 'arena_complete',
      summary: 'Arena passed',
      candidate_ref: relative(root, type === 'skill' ? path.join(candidateRoot, 'SKILL.md') : candidateRoot),
      arena_run_ref: relative(root, scorecardPath),
      arena_decision: 'pass',
      promotion_recommendation: 'promote',
    },
    started_at: '2026-07-15T09:00:00.000Z',
    completed_at: '2026-07-15T11:00:00.000Z',
    manifest_ref: relative(root, dagPath),
  });

  return {
    type,
    name,
    runRoot,
    candidateRoot,
    snapshotRoot,
    subjectId: manifest.subject_id,
    fingerprint: manifest.fingerprint,
    dagPath,
    digestPath,
    inspectorPath,
    candidateDecisionPath,
    arenaResultPath,
    arenaRunPath,
    scorecardPath,
    arenaRunnerPath,
    inspectorCasesPath,
    subjectManifestPath,
    outputContractSourcePath,
    sourceA,
    sourceB,
    arenaTraceA,
    arenaTraceB,
  };
}

function addPassedReplay(root: string, fixture: Fixture): {
  freshTrace: string;
  replayResult: string;
  manifest: string;
  inputs: string;
  comparison: string;
} {
  const arenaRoot = path.join(root, 'arena', 'runs', `evolution-${DATE}-${fixture.name}`);
  const freshTrace = path.join(arenaRoot, 'workspace', 'replay.jsonl');
  const artifactRoot = path.join(arenaRoot, 'debug');
  const manifest = path.join(artifactRoot, 'manifest.json');
  const inputs = path.join(artifactRoot, 'extracted-inputs.json');
  const replayResult = path.join(artifactRoot, 'replay-results.json');
  const comparison = path.join(artifactRoot, 'comparison.json');
  const report = path.join(artifactRoot, 'report.md');
  const replayRole = fixture.type === 'skill' ? 'base' : fixture.name;
  const replaySession = `pet:xiaoba:role-${replayRole}:arena-${fixture.name}-replay`;
  const replayRunId = `${fixture.name}-replay-1`;
  const caseId = `case.evolution-${DATE}-${fixture.name}.replay-source`;
  const sourceTraceRef = relative(root, fixture.arenaTraceA);
  writeJsonl(freshTrace, Array.from({ length: 2 }, (_, index) => promotionArenaTraceRow({
    type: fixture.type,
    candidateName: fixture.name,
    traceId: `arena-${fixture.name}-replay-${index + 1}`,
    sessionKey: replaySession,
    turn: index + 1,
  })));
  const replayInputs = extractTraceReplayInputs(fixture.arenaTraceA, 2);
  writeJson(inputs, replayInputs);
  writeJson(replayResult, replayInputs.map(item => ({
    index: item.index,
    sourceLine: item.sourceLine,
    ok: true,
    status: 200,
    durationMs: 1,
    text: 'ok',
    textEventCount: 1,
    files: [],
    tools: [],
    eventCount: 1,
  })));
  const traceFacts = {
    traceCount: 2,
    userTexts: replayInputs.map(item => item.text),
    toolCounts: { send_text: 2 },
    deliveryEvidenceCount: 2,
    visibleCompletedCount: 0,
    finalVisibleCount: 0,
    failedTools: [],
  };
  writeJson(comparison, {
    oldTrace: traceFacts,
    newTrace: traceFacts,
    inputCountMatches: true,
    userInputsReplayed: true,
    slashCommandsMissingFromTrace: false,
    notes: [],
  });
  writeJson(manifest, {
    replay_version: '0.1',
    run_id: replayRunId,
    generated_at: '2026-07-15T10:30:00.000Z',
    input_trace_path: fixture.arenaTraceA,
    pet_id: 'xiaoba',
    session_key: replaySession,
    replayed_turns: 2,
    fresh_trace_path: freshTrace,
    artifacts: {
      manifest_path: manifest,
      extracted_inputs_path: inputs,
      replay_results_path: replayResult,
      comparison_path: comparison,
      report_path: report,
    },
  });
  writeFile(report, '# Trace Replay Report\n');
  const attempts = {
    planned: 1,
    completed: 1,
    pass_count: 1,
    fail_count: 0,
    blocked_count: 0,
    trace_refs: [relative(root, freshTrace)],
    case_ids: [caseId],
    source_trace_refs: [sourceTraceRef],
  };
  const result = {
    attempt: 1,
    status: 'pass',
    case_id: caseId,
    source_trace_ref: sourceTraceRef,
    replay_run_id: replayRunId,
    session_key: replaySession,
    turn_count: 2,
    fresh_trace_ref: relative(root, freshTrace),
    replay_results_ref: relative(root, replayResult),
    trace_identity_check: {
      expected_sessions: 1,
      verified_sessions: 1,
      expected_turns: 2,
      checked_turns: 2,
      status: 'pass',
    },
    output_contract_check: fixture.type === 'skill' ? {
      declared: true,
      source_ref: relative(root, fixture.outputContractSourcePath),
      expected_turns: 2,
      checked_turns: 2,
      passed_turns: 2,
      violation_count: 0,
      fully_compliant_sessions: 1,
      total_sessions: 1,
      status: 'pass',
    } : {
      declared: false,
      source_ref: null,
      expected_turns: 0,
      checked_turns: 0,
      passed_turns: 0,
      violation_count: 0,
      fully_compliant_sessions: 0,
      total_sessions: 1,
      status: 'not_declared',
    },
  };
  const replayCase = {
    case_id: caseId,
    issue_type: 'tool_failure',
    severity: 'medium',
    evidence_refs: [sourceTraceRef],
    suspected_root_cause: 'retained replay source',
    replay_intent: 'replay retained source',
  };
  updateJson(fixture.inspectorCasesPath, value => {
    const cases = [...value.cases, replayCase];
    return { ...value, case_count: cases.length, cases };
  });
  updateJson(fixture.arenaRunPath, value => ({ ...value, replay_attempts: attempts }));
  updateJson(fixture.scorecardPath, value => ({
    ...value,
    cases: [...value.cases, replayCase],
    replay_attempts: attempts,
    replay_results: [result],
    arena_eval_profile: {
      ...value.arena_eval_profile,
      replay_case_count: 1,
      inspector_case_count: value.cases.length + 1,
      replay_candidate_case_count: 1,
      skipped_replay_case_count: 0,
      planned_replay_attempts: 1,
    },
  }));
  return { freshTrace, replayResult, manifest, inputs, comparison };
}

function writeCandidate(
  root: string,
  type: 'skill' | 'role',
  name: string,
  roleConfig: Record<string, unknown> = {},
): void {
  fs.mkdirSync(root, { recursive: true });
  if (type === 'skill') {
    writeFile(path.join(root, 'SKILL.md'), [
      '---',
      `name: ${name}`,
      'description: Produce a deterministic four-line closeout.',
      'status: candidate',
      'arena-output-line-prefixes:',
      '  - "RESULT::"',
      '  - "EVIDENCE::"',
      '---',
      '',
      '# Closeout',
      '',
      'Return exactly the declared lines.',
      '',
    ].join('\n'));
    return;
  }
  writeJson(path.join(root, 'role.json'), {
    ...roleConfig,
    name,
    displayName: 'CloseoutCat',
    description: 'Produce reliable closeouts.',
    promptFile: `${name}-system-prompt.md`,
    status: 'candidate',
  });
  writeFile(path.join(root, 'prompts', `${name}-system-prompt.md`), '# CloseoutCat\n');
}

function readStatus(root: string, type: 'skill' | 'role'): string | undefined {
  return type === 'skill'
    ? SkillParser.parse(path.join(root, 'SKILL.md')).metadata.status
    : readJson(path.join(root, 'role.json')).status;
}

function updateJson(filePath: string, update: (value: any) => any): void {
  writeJson(filePath, update(readJson(filePath)));
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath: string, value: unknown): void {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTrace(filePath: string, traceId: string, sessionId: string): void {
  writeFile(filePath, `${JSON.stringify(traceRow(traceId, sessionId))}\n`);
}

function traceRow(traceId: string, sessionId: string): Record<string, unknown> {
  return {
    schema_version: 3,
    entry_type: 'trace',
    trace_id: traceId,
    session_id: sessionId,
    session_type: 'pet',
    events: [{ event_type: 'session_completed', status: 'success' }],
  };
}

function promotionArenaTraceRow(input: {
  type: 'skill' | 'role';
  candidateName: string;
  traceId: string;
  sessionKey: string;
  turn: number;
}): Record<string, unknown> {
  const text = input.type === 'skill'
    ? `RESULT::turn ${input.turn}\nEVIDENCE::trace ${input.traceId}`
    : `Role result for turn ${input.turn}`;
  return {
    schema_version: 3,
    entry_type: 'trace',
    trace_id: input.traceId,
    session_id: input.sessionKey,
    session_type: 'pet',
    turn: input.turn,
    user: { text: `request ${input.turn}` },
    tool_visibility: [{
      roleName: input.type === 'skill' ? 'base' : input.candidateName,
      ...(input.type === 'skill' && { activeSkillName: input.candidateName }),
      visibleTools: ['send_text'],
      hiddenToolCount: 0,
    }],
    assistant: {
      text: '',
      tool_calls: [{
        id: `${input.traceId}.send-text`,
        name: 'send_text',
        arguments: { text },
        result: '已发送',
        status: 'success',
        delivery_evidence: [{
          surface: 'pet',
          status: 'delivered',
          delivery_type: 'text',
          timestamp: '2026-07-15T10:00:00.000Z',
          text_preview: text,
        }],
      }],
    },
  };
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  writeFile(filePath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

function relative(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, '/');
}
