import { afterEach, beforeEach, describe, test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EvolutionArenaInput,
  EvolutionArenaResult,
  EvolutionDagDependencies,
  EvolutionRoleStageInput,
  buildEvolutionDagPrompt,
  buildInspectorDagPrompt,
  runEvolutionDag,
} from '../src/roles/evolution-cat/evolution-dag';
import { BuildEvolutionDigestResult } from '../src/roles/evolution-cat/evolution-observer';

const TRACE_A = 'logs/sessions/demo/traces.jsonl#trace-a';
const TRACE_B = 'logs/sessions/demo/traces.jsonl#trace-b';

describe('Inspector-first evolution DAG', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoba-evolution-dag-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('Inspector prompt routes reusable working-method gaps to evolution, not engineering repair', () => {
    const prompt = buildInspectorDagPrompt(
      'output/evolution/sleep/2026-07-14/digest.json',
      '2026-07-14',
    );

    assert.match(prompt, /repeated task-level working method, output protocol, or reusable behavior gap/);
    assert.match(prompt, /Repeated user corrections about how work should be performed or formatted belong here/);
    assert.match(prompt, /Runtime, Tool, Session, permission, trace-collection, or repository-code defect/);
    assert.match(prompt, /Do not choose repair merely because a prompt could be edited/);
  });

  test('Evolution prompt makes a declared fixed-line contract apply to every evaluated turn', () => {
    const prompt = buildEvolutionDagPrompt(
      'output/evolution/sleep/2026-07-14/inspector-route.json',
      'output/evolution/sleep/2026-07-14/digest.json',
      '2026-07-14',
    );

    assert.match(prompt, /exactly one successful send_text/);
    assert.match(prompt, /any mention or meta-question/);
    assert.match(prompt, /first and only text delivery/);
    assert.match(prompt, /pure formatter/);
    assert.match(prompt, /use no other tools/);
  });

  for (const candidateType of ['skill', 'role'] as const) {
    test(`evolution route runs Inspector -> Evolution -> Arena for an isolated ${candidateType}`, async () => {
      const calls: string[] = [];
      let buildCount = 0;
      const result = await runEvolutionDag(baseOptions(root), {
        buildDigest: options => {
          buildCount += 1;
          return fakeDigest(options.workingDirectory, options.targetDate);
        },
        runRoleStage: async input => {
          calls.push(input.roleName);
          if (input.roleName === 'inspector-cat') return inspectorEvolution();
          assert.equal(input.roleName, 'evolution-cat');
          assert.equal(input.workingDirectory, path.join(root, 'output', 'evolution', 'sleep', '2026-07-14'));
          assert.equal(input.allowedWriteRoot, path.join(input.workingDirectory, 'candidates'));
          assert.ok(input.hiddenTools?.includes('execute_shell'));
          assert.ok(input.hiddenTools?.includes('remember'));
          writeCandidate(input.workingDirectory, candidateType, 'daily-brief');
          return JSON.stringify({
            version: 1,
            status: 'candidate',
            summary: 'Repeated daily brief workflow extracted',
            evidence_refs: [TRACE_A, TRACE_B],
            candidate: {
              type: candidateType,
              name: 'daily-brief',
              path: 'candidates/daily-brief',
            },
          });
        },
        runArena: async input => {
          calls.push('arena');
          assert.equal(input.candidate.type, candidateType);
          assert.equal(input.candidate.name, 'daily-brief');
          assert.ok(input.candidate.path.includes('/output/evolution/sleep/2026-07-14/candidates/'));
          const scorecardRef = 'arena/runs/arena-daily-brief/arena-scorecard.json';
          writeLocalEvidence(root, scorecardRef);
          return fakeArenaResult('arena-daily-brief', 'pass', scorecardRef);
        },
      });

      assert.equal(buildCount, 1);
      assert.deepEqual(calls, ['inspector-cat', 'evolution-cat', 'arena']);
      assert.equal(result.status, 'completed');
      assert.equal(result.route, 'evolution');
      assert.equal(result.terminal?.status, 'arena_complete');
      assert.equal(result.terminal?.promotion_recommendation, 'promote');
      assert.equal(fs.existsSync(path.join(root, 'skills')), false);
      assert.equal(fs.existsSync(path.join(root, 'roles')), false);
      assert.equal(fs.existsSync(path.join(root, 'memory')), false);
    });
  }

  test('Arena blocked leaves the isolated candidate unassessed', async () => {
    let candidatePath = '';
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorEvolution();
        writeCandidate(input.workingDirectory, 'skill', 'unassessed-capability');
        return JSON.stringify({
          version: 1,
          status: 'candidate',
          summary: 'candidate ready for evaluation',
          evidence_refs: [TRACE_A, TRACE_B],
          candidate: { type: 'skill', name: 'unassessed-capability', path: 'candidates/unassessed-capability' },
        });
      },
      runArena: async input => {
        candidatePath = input.candidate.path;
        const scorecardRef = 'arena/runs/unassessed/arena-scorecard.json';
        writeLocalEvidence(root, scorecardRef);
        return fakeArenaResult('unassessed', 'blocked', scorecardRef);
      },
    });

    assert.equal(result.terminal?.arena_decision, 'blocked');
    assert.equal(result.terminal?.promotion_recommendation, undefined);
    assert.match(fs.readFileSync(candidatePath, 'utf-8'), /status: candidate/);
  });

  test('Evolution may leave exactly one declared candidate package', async () => {
    let arenaCalled = false;
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorEvolution();
        writeCandidate(input.workingDirectory, 'skill', 'daily-brief');
        writeCandidate(input.workingDirectory, 'skill', 'undeclared-extra');
        return JSON.stringify({
          version: 1,
          status: 'candidate',
          summary: 'declared one of two packages',
          evidence_refs: [TRACE_A, TRACE_B],
          candidate: { type: 'skill', name: 'daily-brief', path: 'candidates/daily-brief' },
        });
      },
      runArena: async () => {
        arenaCalled = true;
        throw new Error('must not run');
      },
    });

    assert.equal(result.status, 'blocked');
    assert.equal(arenaCalled, false);
    assert.match(result.terminal?.summary || '', /exactly one candidate package/);
  });

  for (const invalidPrompt of ['missing', 'traversal'] as const) {
    test(`Role candidate fails closed when its prompt is ${invalidPrompt}`, async () => {
      let arenaCalled = false;
      const result = await runEvolutionDag(baseOptions(root), {
        buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
        runRoleStage: async input => {
          if (input.roleName === 'inspector-cat') return inspectorEvolution();
          writeCandidate(input.workingDirectory, 'role', 'daily-brief');
          const candidateRoot = path.join(input.workingDirectory, 'candidates', 'daily-brief');
          if (invalidPrompt === 'missing') {
            fs.unlinkSync(path.join(candidateRoot, 'prompts', 'daily-brief-system-prompt.md'));
          } else {
            const rolePath = path.join(candidateRoot, 'role.json');
            const role = JSON.parse(fs.readFileSync(rolePath, 'utf-8'));
            fs.writeFileSync(rolePath, JSON.stringify({ ...role, promptFile: '../outside.md' }), 'utf-8');
          }
          return JSON.stringify({
            version: 1,
            status: 'candidate',
            summary: 'candidate with invalid prompt',
            evidence_refs: [TRACE_A, TRACE_B],
            candidate: { type: 'role', name: 'daily-brief', path: 'candidates/daily-brief' },
          });
        },
        runArena: async () => {
          arenaCalled = true;
          throw new Error('must not run');
        },
      });

      assert.equal(result.status, 'blocked');
      assert.equal(arenaCalled, false);
      assert.match(
        result.terminal?.summary || '',
        invalidPrompt === 'missing' ? /prompt does not exist/ : /safe promptFile/,
      );
    });
  }

  test('Evolution cannot override the Inspector route with no_op', async () => {
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorEvolution();
        return JSON.stringify({
          version: 1,
          status: 'no_op',
          summary: 'claimed no candidate',
          evidence_refs: [TRACE_A, TRACE_B],
          reason: 'not reusable',
        });
      },
      runArena: unexpectedArena,
    });

    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /Evolution\.status must be one of: candidate, blocked/);
  });

  test('repair route runs Inspector -> Engineer -> Reviewer and Reviewer cannot mutate code', async () => {
    const calls: EvolutionRoleStageInput[] = [];
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        calls.push(input);
        if (input.roleName === 'inspector-cat') return inspectorRepair();
        if (input.roleName === 'engineer-cat') {
          writeLocalEvidence(root, 'src/core/retry.ts');
          writeLocalEvidence(root, 'output/test/retry.txt');
          return JSON.stringify({
            version: 1,
            status: 'fixed',
            summary: 'runtime retry budget fixed',
            artifact_refs: ['src/core/retry.ts'],
            verification_refs: ['output/test/retry.txt'],
          });
        }
        const replayRef = writeReviewerEvidence(root, '2026-07-14', 'report.md');
        return JSON.stringify({
          version: 1,
          status: 'closed',
          summary: 'fresh replay passed',
          evidence_refs: [replayRef],
        });
      },
      runArena: unexpectedArena,
    });

    assert.deepEqual(calls.map(call => call.roleName), ['inspector-cat', 'engineer-cat', 'reviewer-cat']);
    const reviewer = calls[2];
    const engineer = calls[1];
    assert.ok(engineer.hiddenTools?.includes('ask_parent'));
    assert.ok(reviewer.hiddenTools?.includes('codex_job_start'));
    assert.ok(reviewer.hiddenTools?.includes('execute_shell'));
    assert.ok(reviewer.hiddenTools?.includes('reviewer_xiaoba_cli_e2e'));
    assert.ok(reviewer.hiddenTools?.includes('reviewer_module_test'));
    assert.ok(reviewer.hiddenTools?.includes('reviewer_eval_prepare'));
    assert.ok(reviewer.hiddenTools?.includes('ask_parent'));
    assert.ok(!reviewer.hiddenTools?.includes('reviewer_trace_replay'));
    assert.match(reviewer.task, /Engineer result:/);
    assert.match(reviewer.task, /reviewer_trace_replay exactly once with \{\}/);
    assert.match(reviewer.task, /output\/evolution\/sleep\/2026-07-14\/reviewer-replay\//);
    assert.equal(result.terminal?.status, 'closed');
    assert.equal(result.stages.some(stage => stage.name === 'arena'), false);
  });

  test('blocked Engineer stops before Reviewer', async () => {
    const calls: string[] = [];
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        calls.push(input.roleName);
        if (input.roleName === 'inspector-cat') return inspectorRepair();
        return JSON.stringify({
          version: 1,
          status: 'blocked',
          summary: 'missing fixture',
          artifact_refs: [],
          verification_refs: [],
          reason: 'required fixture is unavailable',
        });
      },
      runArena: unexpectedArena,
    });

    assert.deepEqual(calls, ['inspector-cat', 'engineer-cat']);
    assert.equal(result.status, 'blocked');
    assert.equal(result.terminal?.status, 'blocked');
  });

  test('Engineer cannot claim fixed with a missing artifact ref', async () => {
    const calls: string[] = [];
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        calls.push(input.roleName);
        if (input.roleName === 'inspector-cat') return inspectorRepair();
        return JSON.stringify({
          version: 1,
          status: 'fixed',
          summary: 'claimed without evidence',
          artifact_refs: ['output/missing-fix.patch'],
          verification_refs: [],
        });
      },
      runArena: unexpectedArena,
    });
    assert.deepEqual(calls, ['inspector-cat', 'engineer-cat']);
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /does not exist/);
  });

  test('replay route runs Reviewer directly and next_run never loops in the same run', async () => {
    const calls: string[] = [];
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        calls.push(input.roleName);
        if (input.roleName === 'inspector-cat') return inspectorReplay();
        const replayRef = writeReviewerEvidence(root, '2026-07-14', 'report.md');
        return JSON.stringify({
          version: 1,
          status: 'next_run',
          summary: 'failure reproduced; route repair next run',
          evidence_refs: [replayRef],
        });
      },
      runArena: unexpectedArena,
    });

    assert.deepEqual(calls, ['inspector-cat', 'reviewer-cat']);
    assert.equal(result.terminal?.status, 'next_run');
    assert.ok(result.terminal?.next_run_seed_ref);
    assert.equal(fs.existsSync(path.join(root, String(result.terminal?.next_run_seed_ref))), true);
  });

  test('next_run remains pending until a later replay closes or supersedes it', async () => {
    await runEvolutionDag(baseOptions(root, '2026-07-14'), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorReplay();
        const replayRef = writeReviewerEvidence(root, '2026-07-14', 'report.md');
        return JSON.stringify({
          version: 1,
          status: 'next_run',
          summary: 'failure reproduced; route repair next run',
          evidence_refs: [replayRef],
        });
      },
      runArena: unexpectedArena,
    });

    let secondPrompt = '';
    const second = await runEvolutionDag(baseOptions(root, '2026-07-15'), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        secondPrompt = input.task;
        return inspectorNoOp();
      },
      runArena: unexpectedArena,
    });
    assert.match(secondPrompt, /Previous unresolved handoff: output\/evolution\/sleep\/2026-07-14\/next-run-seed\.json/);
    assert.equal(
      second.next_run_seed_input_ref,
      'output/evolution/sleep/2026-07-14/next-run-seed.json',
    );
    assert.equal(second.status, 'blocked');
    assert.match(second.terminal?.summary || '', /must route to repair or replay/);
    assert.equal(
      fs.existsSync(path.join(root, 'output', 'evolution', 'sleep', '2026-07-14', 'next-run-seed-consumed.json')),
      false,
    );

    let resolutionPrompt = '';
    const resolved = await runEvolutionDag(baseOptions(root, '2026-07-16'), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') {
          resolutionPrompt = input.task;
          return inspectorPendingReplay('output/evolution/sleep/2026-07-14/next-run-seed.json');
        }
        const replayRef = writeReviewerEvidence(root, '2026-07-16', 'report.md');
        return JSON.stringify({
          version: 1,
          status: 'closed',
          summary: 'pending replay closed with fresh evidence',
          evidence_refs: [replayRef],
        });
      },
      runArena: unexpectedArena,
    });
    assert.match(resolutionPrompt, /Previous unresolved handoff: output\/evolution\/sleep\/2026-07-14\/next-run-seed\.json/);
    assert.equal(resolved.terminal?.status, 'closed');
    assert.equal(
      fs.existsSync(path.join(root, 'output', 'evolution', 'sleep', '2026-07-14', 'next-run-seed-consumed.json')),
      true,
    );

    let thirdPrompt = '';
    await runEvolutionDag(baseOptions(root, '2026-07-17'), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        thirdPrompt = input.task;
        return inspectorNoOp();
      },
      runArena: unexpectedArena,
    });
    assert.match(thirdPrompt, /Previous unresolved handoff: none/);
  });

  test('same-date rerun preserves an unresolved next_run instead of deleting it', async () => {
    const first = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorReplay();
        const replayRef = writeReviewerEvidence(root, '2026-07-14', 'report.md');
        return JSON.stringify({
          version: 1,
          status: 'next_run',
          summary: 'carry this replay to the next scheduled run',
          evidence_refs: [replayRef],
        });
      },
      runArena: unexpectedArena,
    });
    const manifestPath = path.join(root, 'output', 'evolution', 'sleep', '2026-07-14', 'dag-run.json');
    const seedPath = path.join(root, 'output', 'evolution', 'sleep', '2026-07-14', 'next-run-seed.json');
    const originalManifest = fs.readFileSync(manifestPath, 'utf-8');
    const originalSeed = fs.readFileSync(seedPath, 'utf-8');
    let roleCalls = 0;

    const second = await runEvolutionDag(baseOptions(root), {
      buildDigest: () => {
        throw new Error('same-date unresolved run must not harvest again');
      },
      runRoleStage: async () => {
        roleCalls += 1;
        throw new Error('same-date unresolved run must not call a role');
      },
      runArena: unexpectedArena,
    });

    assert.equal(first.terminal?.status, 'next_run');
    assert.equal(second.terminal?.status, 'next_run');
    assert.equal(roleCalls, 0);
    assert.equal(fs.readFileSync(manifestPath, 'utf-8'), originalManifest);
    assert.equal(fs.readFileSync(seedPath, 'utf-8'), originalSeed);
  });

  test('Inspector evolution evidence must span two independent task lineages', async () => {
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => {
        const digest = fakeDigest(options.workingDirectory, options.targetDate);
        digest.digest.observations[1].session_id = digest.digest.observations[0].session_id;
        return digest;
      },
      runRoleStage: async () => inspectorEvolution(),
      runArena: unexpectedArena,
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /two independent task lineages/);
  });

  test('Reviewer cannot close a case with an invented replay ref', async () => {
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => input.roleName === 'inspector-cat'
        ? inspectorReplay()
        : JSON.stringify({
          version: 1,
          status: 'closed',
          summary: 'claimed closed',
          evidence_refs: ['output/replay/missing.json'],
        }),
      runArena: unexpectedArena,
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /reviewer-replay/);
  });

  test('Reviewer cannot close with an existing local file outside this run reviewer-replay prefix', async () => {
    writeLocalEvidence(root, 'output/replay/old-but-real.json');
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => input.roleName === 'inspector-cat'
        ? inspectorReplay()
        : JSON.stringify({
          version: 1,
          status: 'closed',
          summary: 'claimed closed with stale local evidence',
          evidence_refs: ['output/replay/old-but-real.json'],
        }),
      runArena: unexpectedArena,
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /reviewer-replay/);
  });

  test('Reviewer cannot reuse an approved replay filename left by an earlier same-date run', async () => {
    const replayRef = writeReviewerEvidence(root, '2026-07-14', 'report.md');
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => input.roleName === 'inspector-cat'
        ? inspectorReplay()
        : JSON.stringify({
          version: 1,
          status: 'closed',
          summary: 'claimed closed with stale same-date evidence',
          evidence_refs: [replayRef],
        }),
      runArena: unexpectedArena,
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /must exist under this run/);
  });

  test('Reviewer cannot substitute an arbitrary file inside reviewer-replay for deterministic replay output', async () => {
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorReplay();
        writeReviewerEvidence(root, '2026-07-14', 'summary.json');
        return JSON.stringify({
          version: 1,
          status: 'closed',
          summary: 'claimed closed with a non-replay artifact',
          evidence_refs: ['output/evolution/sleep/2026-07-14/reviewer-replay/summary.json'],
        });
      },
      runArena: unexpectedArena,
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /reviewer_trace_replay result/);
  });

  test('Reviewer evidence cannot escape this run reviewer-replay prefix through a symlink', async () => {
    writeLocalEvidence(root, 'output/replay/old-target.json');
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorReplay();
        const replayRoot = path.join(root, 'output', 'evolution', 'sleep', '2026-07-14', 'reviewer-replay');
        fs.symlinkSync(
          path.join(root, 'output', 'replay', 'old-target.json'),
          path.join(replayRoot, 'report.md'),
        );
        return JSON.stringify({
          version: 1,
          status: 'closed',
          summary: 'claimed closed with linked evidence',
          evidence_refs: ['output/evolution/sleep/2026-07-14/reviewer-replay/report.md'],
        });
      },
      runArena: unexpectedArena,
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /symlink/);
  });

  test('Evolution cannot replace Inspector evidence with invented refs', async () => {
    let arenaCalled = false;
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => input.roleName === 'inspector-cat'
        ? inspectorEvolution()
        : JSON.stringify({
          version: 1,
          status: 'candidate',
          summary: 'invented provenance',
          evidence_refs: [TRACE_A, 'logs/sessions/demo/traces.jsonl#invented'],
          candidate: { type: 'skill', name: 'bad-candidate', path: 'candidates/bad-candidate' },
        }),
      runArena: async () => {
        arenaCalled = true;
        throw new Error('must not run');
      },
    });
    assert.equal(result.status, 'blocked');
    assert.equal(arenaCalled, false);
    assert.match(result.terminal?.summary || '', /unowned ref/);
  });

  test('Evolution cannot reuse a candidate left by an earlier same-date run', async () => {
    const runRoot = path.join(root, 'output', 'evolution', 'sleep', '2026-07-14');
    writeCandidate(runRoot, 'skill', 'stale-candidate');
    let arenaCalled = false;
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => input.roleName === 'inspector-cat'
        ? inspectorEvolution()
        : JSON.stringify({
          version: 1,
          status: 'candidate',
          summary: 'claimed an old candidate',
          evidence_refs: [TRACE_A, TRACE_B],
          candidate: { type: 'skill', name: 'stale-candidate', path: 'candidates/stale-candidate' },
        }),
      runArena: async () => {
        arenaCalled = true;
        throw new Error('must not run');
      },
    });
    assert.equal(result.status, 'blocked');
    assert.equal(arenaCalled, false);
    assert.match(result.terminal?.summary || '', /exactly one candidate package/);
  });

  test('Arena completion requires an existing local scorecard', async () => {
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        if (input.roleName === 'inspector-cat') return inspectorEvolution();
        writeCandidate(input.workingDirectory, 'skill', 'daily-brief');
        return JSON.stringify({
          version: 1,
          status: 'candidate',
          summary: 'candidate ready',
          evidence_refs: [TRACE_A, TRACE_B],
          candidate: { type: 'skill', name: 'daily-brief', path: 'candidates/daily-brief' },
        });
      },
      runArena: async () => fakeArenaResult(
        'arena-missing',
        'pass',
        'arena/runs/arena-missing/scorecard.json',
      ),
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /does not exist/);
  });

  for (const candidateType of ['skill', 'role'] as const) {
    test(`Arena definitive rejection blocks the isolated ${candidateType} candidate`, async () => {
      let candidatePath = '';
      const result = await runEvolutionDag(baseOptions(root), {
        buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
        runRoleStage: async input => {
          if (input.roleName === 'inspector-cat') return inspectorEvolution();
          writeCandidate(input.workingDirectory, candidateType, 'rejected-capability');
          return JSON.stringify({
            version: 1,
            status: 'candidate',
            summary: 'candidate ready for evaluation',
            evidence_refs: [TRACE_A, TRACE_B],
            candidate: { type: candidateType, name: 'rejected-capability', path: 'candidates/rejected-capability' },
          });
        },
        runArena: async input => {
          candidatePath = input.candidate.path;
          const scorecardRef = 'arena/runs/rejected/arena-scorecard.json';
          writeLocalEvidence(root, scorecardRef);
          return fakeArenaResult('rejected', 'unsafe', scorecardRef);
        },
      });

      assert.equal(result.terminal?.arena_decision, 'unsafe');
      if (candidateType === 'skill') {
        assert.match(fs.readFileSync(candidatePath, 'utf-8'), /status: blocked/);
      } else {
        assert.equal(JSON.parse(fs.readFileSync(path.join(candidatePath, 'role.json'), 'utf-8')).status, 'blocked');
      }
    });
  }

  test('no_op is an explicit terminal route with no downstream role', async () => {
    const calls: string[] = [];
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async input => {
        calls.push(input.roleName);
        return JSON.stringify({
          version: 1,
          route: 'no_op',
          summary: 'No repeated actionable signal',
          finding_refs: [],
          evidence_refs: [],
          reason: 'insufficient_signal',
        });
      },
      runArena: unexpectedArena,
    });

    assert.deepEqual(calls, ['inspector-cat']);
    assert.equal(result.status, 'completed');
    assert.equal(result.terminal?.status, 'no_op');
    assert.equal(result.terminal?.summary, 'insufficient_signal');
  });

  test('same-date rerun starts from a fresh run root', async () => {
    const runRoot = path.join(root, 'output', 'evolution', 'sleep', '2026-07-14');
    writeLocalEvidence(root, 'output/evolution/sleep/2026-07-14/next-run-seed.json');
    writeLocalEvidence(root, 'output/evolution/sleep/2026-07-14/stale-stage-output.txt');

    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async () => inspectorNoOp(),
      runArena: unexpectedArena,
    });

    assert.equal(result.terminal?.status, 'no_op');
    assert.equal(fs.existsSync(path.join(runRoot, 'next-run-seed.json')), false);
    assert.equal(fs.existsSync(path.join(runRoot, 'stale-stage-output.txt')), false);
    assert.equal(fs.existsSync(path.join(runRoot, 'dag-run.json')), true);
  });

  for (const invalid of [
    { name: 'missing contract version', value: { route: 'no_op', summary: 'bad', finding_refs: [], evidence_refs: [], reason: 'missing_version' } },
    { name: 'unsupported contract version', value: { version: 2, route: 'no_op', summary: 'bad', finding_refs: [], evidence_refs: [], reason: 'future_version' } },
    { name: 'unknown route', value: { version: 1, route: 'base', summary: 'bad', finding_refs: [], evidence_refs: [] } },
    { name: 'replay without case', value: { version: 1, route: 'replay', summary: 'bad', finding_refs: ['observation:obs-a'], evidence_refs: [TRACE_A] } },
    { name: 'evolution with one trace', value: { version: 1, route: 'evolution', summary: 'bad', finding_refs: ['observation:obs-a'], evidence_refs: [TRACE_A] } },
    { name: 'unowned evidence ref', value: { version: 1, route: 'evolution', summary: 'bad', finding_refs: ['pattern:daily-brief'], evidence_refs: [TRACE_A, 'logs/sessions/demo/traces.jsonl#invented'] } },
    { name: 'unowned finding ref', value: { version: 1, route: 'evolution', summary: 'bad', finding_refs: ['pattern:invented'], evidence_refs: [TRACE_A, TRACE_B] } },
    { name: 'evidence belongs to another finding', value: { version: 1, route: 'replay', summary: 'bad', finding_refs: ['observation:obs-a'], evidence_refs: [TRACE_B], replay_case: { ...replayCase(), source_trace_refs: [TRACE_B] } } },
    { name: 'replay source omitted from evidence', value: { version: 1, route: 'replay', summary: 'bad', finding_refs: ['observation:obs-a'], evidence_refs: [TRACE_A], replay_case: { ...replayCase(), source_trace_refs: [TRACE_B] } } },
  ]) {
    test(`invalid Inspector contract fails closed: ${invalid.name}`, async () => {
      const calls: string[] = [];
      const result = await runEvolutionDag(baseOptions(root), {
        buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
        runRoleStage: async input => {
          calls.push(input.roleName);
          return JSON.stringify(invalid.value);
        },
        runArena: unexpectedArena,
      });
      assert.deepEqual(calls, ['inspector-cat']);
      assert.equal(result.status, 'blocked');
      assert.equal(result.terminal?.status, 'blocked');
      assert.notEqual(result.terminal?.status, 'no_op');
    });
  }

  test('contract parser rejects prose wrapped around an otherwise valid JSON object', async () => {
    const result = await runEvolutionDag(baseOptions(root), {
      buildDigest: options => fakeDigest(options.workingDirectory, options.targetDate),
      runRoleStage: async () => `I think this is right.\n${inspectorNoOp()}`,
      runArena: unexpectedArena,
    });
    assert.equal(result.status, 'blocked');
    assert.match(result.terminal?.summary || '', /one valid JSON object/);
  });
});

function baseOptions(root: string, targetDate = '2026-07-14') {
  return {
    workingDirectory: root,
    targetDate,
    minOccurrences: 2,
  };
}

function fakeDigest(root: string, date: string): BuildEvolutionDigestResult {
  const outputRoot = path.join(root, 'output', 'evolution', 'sleep', date);
  const digestPath = path.join(outputRoot, 'digest.json');
  const proposalDirectory = path.join(outputRoot, 'proposals');
  fs.mkdirSync(proposalDirectory, { recursive: true });
  writeLocalEvidence(root, 'logs/sessions/demo/traces.jsonl');
  const digest = {
    schema_version: 1 as const,
    run_id: `sleep-${date}`,
    source: 'xiaoba_session_log_v3' as const,
    generated_at: '2026-07-15T00:00:00.000Z',
    window: {
      target_date: date,
      timezone: 'Asia/Shanghai',
      start_inclusive: '2026-07-13T16:00:00.000Z',
      end_exclusive: '2026-07-14T16:00:00.000Z',
    },
    source_root: 'logs/sessions',
    proposal_dir: path.relative(root, proposalDirectory),
    totals: {
      trace_files: 2,
      parsed_rows: 2,
      malformed_rows: 0,
      duplicate_rows: 0,
      non_terminal_rows: 0,
      self_run_rows: 0,
      synthetic_or_replay_rows: 0,
      observations: 2,
      sessions: 2,
      recurring_patterns: 1,
    },
    patterns: [{
      pattern_id: 'daily-brief',
      occurrence_count: 2,
      intent_signature: 'daily brief',
      tool_sequence: [],
      terminal_status_counts: { success: 2 },
      error_codes: [],
      artifact_refs: [],
      sample_trace_refs: [TRACE_A, TRACE_B],
      sample_user_intents: ['build a daily brief'],
    }],
    observations: [
      observation('obs-a', 'trace-a', TRACE_A, date),
      observation('obs-b', 'trace-b', TRACE_B, date),
    ],
  };
  fs.writeFileSync(digestPath, JSON.stringify(digest), 'utf-8');
  return { digest, digestPath, proposalDirectory, artifactAction: 'created' };
}

function inspectorEvolution(): string {
  return JSON.stringify({
    version: 1,
    route: 'evolution',
    summary: 'Daily brief work repeats across sessions',
    finding_refs: ['pattern:daily-brief'],
    evidence_refs: [TRACE_A, TRACE_B],
  });
}

function inspectorRepair(): string {
  return JSON.stringify({
    version: 1,
    route: 'repair',
    summary: 'retry budget is broken',
    finding_refs: ['observation:obs-a'],
    evidence_refs: [TRACE_A],
    replay_case: replayCase(),
  });
}

function inspectorReplay(): string {
  return JSON.stringify({
    version: 1,
    route: 'replay',
    summary: 'one failure needs independent reproduction',
    finding_refs: ['observation:obs-a'],
    evidence_refs: [TRACE_A],
    replay_case: replayCase(),
  });
}

function inspectorPendingReplay(seedRef: string): string {
  return JSON.stringify({
    version: 1,
    route: 'replay',
    summary: 'resolve the carried replay case',
    finding_refs: [`handoff:${seedRef}`],
    evidence_refs: [seedRef, TRACE_A],
    replay_case: replayCase(),
  });
}

function replayCase() {
  return {
    id: 'retry-case',
    intent: 'repeat the failed request in a clean session',
    expected_outcome: 'stable user-visible delivery',
    source_trace_refs: [TRACE_A],
  };
}

function inspectorNoOp(): string {
  return JSON.stringify({
    version: 1,
    route: 'no_op',
    summary: 'No actionable work remains',
    finding_refs: [],
    evidence_refs: [],
    reason: 'resolved_or_insufficient_signal',
  });
}

function observation(id: string, traceId: string, traceRef: string, date: string) {
  return {
    observation_id: id,
    trace_id: traceId,
    trace_ref: traceRef,
    timestamp: `${date}T08:00:00.000Z`,
    session_id: `session-${id}`,
    session_type: 'chat',
    terminal_status: 'success',
    user_intent: 'build a daily brief',
    assistant_outcome: 'brief delivered',
    tool_sequence: [],
    tool_results: [],
  };
}

function writeLocalEvidence(root: string, ref: string): void {
  const filePath = path.join(root, ref);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{}\n', 'utf-8');
}

function fakeArenaResult(
  runId: string,
  decision: EvolutionArenaResult['decision'],
  scorecardRef: string,
): EvolutionArenaResult {
  return {
    run_id: runId,
    decision,
    scorecard_ref: scorecardRef,
    subject_id: `skill-${runId}`,
    subject_manifest_ref: `arena/subjects/skill-${runId}/arena-manifest.json`,
    subject_fingerprint: 'a'.repeat(64),
  };
}

function writeReviewerEvidence(root: string, date: string, fileName: string): string {
  const ref = `output/evolution/sleep/${date}/reviewer-replay/${fileName}`;
  writeLocalEvidence(root, ref);
  return ref;
}

function writeCandidate(stageRoot: string, type: 'skill' | 'role', name: string): void {
  const candidateRoot = path.join(stageRoot, 'candidates', name);
  fs.mkdirSync(candidateRoot, { recursive: true });
  if (type === 'skill') {
    fs.writeFileSync(path.join(candidateRoot, 'SKILL.md'), [
      '---',
      `name: ${name}`,
      'description: Build a daily brief from stable session evidence.',
      'status: candidate',
      '---',
      '',
      '# Daily brief',
    ].join('\n'), 'utf-8');
    return;
  }
  fs.mkdirSync(path.join(candidateRoot, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(candidateRoot, 'role.json'), JSON.stringify({
    name,
    displayName: 'DailyBriefCat',
    description: 'Build evidence-backed daily briefs.',
    promptFile: 'daily-brief-system-prompt.md',
    status: 'candidate',
  }), 'utf-8');
  fs.writeFileSync(
    path.join(candidateRoot, 'prompts', 'daily-brief-system-prompt.md'),
    '# DailyBriefCat\n',
    'utf-8',
  );
}

async function unexpectedArena(_input: EvolutionArenaInput): Promise<never> {
  throw new Error('Arena must not be called on this route');
}
