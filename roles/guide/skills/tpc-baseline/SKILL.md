---
name: tpc-baseline
description: Build and iterate a ChinaTravel TPC schema-valid plus official-verifier repair baseline.
aliases:
  - chinatravel-baseline
  - verifier-repair
  - travel-planning-baseline
user-invocable: true
auto-invocable: true
---

# TPC Baseline

Use this skill when Guide is asked to work on the ChinaTravel / TPC competition, generate Phase 1 prediction files, inspect verifier failures, design a repair loop, or prepare a Phase 2 harness plan.

## Default Inputs

```text
phase1_en_tasks = /Users/guowei/minimind/data/ijcai2026_chinatravel/TPC_IJCAI_2026_phase1_EN/
official_repo = https://github.com/LAMDA-NeSy/ChinaTravel
official_eval = python eval_tpc.py --splits <split> --method <method> --lang en
```

## Workflow

1. Re-check the official competition page or local official repository if submission or scoring details may have changed.
2. Run or read the `data-profiling` skill output before changing planner tools or repair strategy:
   - current profile: `output/guide/data-profile/phase1-en-v0/profile.md`;
   - use the profile to decide whether the next change is parser, binder, route, budget, or failure-taxonomy work.
3. After every official verifier run, run or read the `eval-analysis` skill output before changing repair strategy:
   - current analysis: `output/guide/eval-analysis/phase1-v12-quoteparse-full/eval-analysis.md`;
   - prefer the `guide_tpc_eval_analysis` runtime tool when the official repo and prediction directory are available;
   - use the stage matrix to decide whether the next change must repair schema, commonsense/environment, raw hard logic, FPR overlap, or preferences.
4. Prefer the `guide_tpc_baseline` runtime tool for the first measurable run:
   - use default `dataset_dir` for the Phase 1 EN tasks;
   - pass `run_id`, `method_name`, `team_name`, and `version` when reproducibility matters;
   - pass `official_repo_dir` and `run_verifier=true` once a local ChinaTravel repo and official environment database exist.
5. Prefer the `guide_tpc_env_baseline` runtime tool for the current Phase 1 scoring path when official environment imports are available:
   - run with `method_name=guide_v12_quoteparse` and `run_verifier=true` for full evidence;
   - current full artifact: `output/guide/tpc-env-baseline/phase1-v12-quoteparse-full/`;
   - current zip: `output/guide/tpc-env-baseline/phase1-v12-quoteparse-full/XiaoBaGuide_venv12.zip`;
   - current official score: overall 90.3290 / FPR 93.8.
6. Inspect the local task directory:
   - count JSON files;
   - inspect keys;
   - sample `nature_language` and `hard_logic_py`;
   - identify split naming required by the official loader.
7. Inspect the official output schema and verifier entrypoint.
8. Create or update a method output directory under the official repo's `results/<method>_en/` or the local baseline output root.
9. Generate conservative itinerary JSON:
   - copy exact task-level `people_number`, `start_city`, `target_city`;
   - create exactly `days` day objects;
   - use valid activity and transport fields;
   - keep times ordered and plausible;
   - prefer verifier-valid environment entities over invented entities.
10. Run schema validation and then official `eval_tpc.py`.
11. Classify failures:
   - schema failure;
   - environment or commonsense failure;
   - hard logic failure;
   - preference weakness;
   - loader/path/submission packaging issue.
12. Repair only the failing class and rerun the verifier.
13. Record evidence:
   - command;
   - output path;
   - pass/fail counts;
   - representative failing uid;
   - repair decision.
14. Package only prediction files into `{TeamName}_v{x}.zip`; mark submission readiness blocked until local verifier evidence exists or a concrete environment-data blocker is recorded.

## Quality Bar

A useful baseline is:

- schema-valid for nearly all tasks;
- measured by official verifier output;
- deterministic enough to rerun;
- conservative about hard constraints;
- decomposed by official eval stage, not only aggregate score;
- explicit about unresolved failures;
- structured so verifier failures can become training or repair data later.

Reject or block work that:

- optimizes travel prose before JSON validity;
- claims scores without `eval_tpc.py` evidence;
- submits code/model files for Phase 1;
- depends on private absolute paths inside submitted prediction JSON;
- mutates official verifier files without keeping an untouched source copy.

## Output Template

```text
Guide TPC baseline status:
- task source:
- method name:
- prediction dir:
- verifier command:
- schema status:
- environment status:
- logic status:
- final pass ratio:
- soft preference notes:
- top failure classes:
- repaired since last run:
- next repair action:
- submission readiness:
```
