---
name: eval-analysis
description: Analyze ChinaTravel TPC official verifier stages and convert scorecards into repair priorities.
aliases:
  - tpc-eval-analysis
  - chinatravel-eval-analysis
  - guide-verifier-analysis
user-invocable: true
auto-invocable: true
---

# Eval Analysis

Use this skill after `guide_tpc_baseline` or any Guide prediction run has official verifier output. The goal is to understand which verifier stage blocks score improvement before adding planner tools, prompts, or model work.

## Required Inputs

```text
official_repo = /tmp/chinatravel-official-xiaoba-guide or a durable ChinaTravel checkout
predictions = results/<method>_en/<uid>.json
split = tpc_phase1
lang = en
```

## Workflow

1. Confirm the official repo, prediction directory, `database`, `database_en`, and split file exist.
2. Read the executable scorer path, not only the website summary:
   - `eval_tpc.py`;
   - `chinatravel/evaluation/schema_constraint.py`;
   - `chinatravel/evaluation/commonsense_constraint.py`;
   - `chinatravel/evaluation/hard_constraint.py`;
   - `chinatravel/evaluation/preference.py`.
3. Call official evaluation functions directly when `eval_tpc.py` only writes aggregate scores:
   - `evaluate_schema_constraints`;
   - `evaluate_commonsense_constraints`;
   - `evaluate_hard_constraints_v2`;
   - preference only after `all_pass_id` is non-empty.
4. Export stage artifacts under `output/guide/eval-analysis/<run_id>/`:
   - `eval-analysis.md`;
   - `eval-analysis.json`;
   - `commonsense-errors.csv`;
   - `hard-logic-failures.csv`;
   - `hard-logic-by-uid.csv`;
   - `uid-stage-summary.csv`.
5. Derive repair order from verifier gates:
   - schema failures first;
   - commonsense/environment failures before conditional logic score;
   - hard logic parser/binder once environment records are real;
   - FPR only after schema, commonsense, and hard logic overlap;
   - DAV/ATT/DDR only after some `all_pass_id` exists.

## Current Phase 1 Eval Analysis

Current analysis artifact:

```text
output/guide/eval-analysis/phase1-v12-quoteparse-full/eval-analysis.md
output/guide/eval-analysis/phase1-v12-quoteparse-full/eval-analysis.json
```

Key findings:

- Schema passed 1000/1000.
- Commonsense/environment passed 999/1000; MicEPR 99.996, MacEPR 99.9.
- Raw hard logic passed 938/1000 full tasks; raw hard micro is 98.206 and raw hard macro is 93.8.
- C-LPR is 98.0661 and FPR is 93.8 because 938 uid reach all-pass.
- DAV/ATT/DDR are 1.7546 / 95.2431 / 68.8682 on `all_pass_id`.
- Top commonsense failure is now one residual `Does not follow Chronological Order` edge case.
- Top hard-logic failures are other.unclassified, budget.innercity_cost, accommodation.type.choice, accommodation.name.require, attraction.type.require, restaurant.name.require and restaurant.type.require cases.
- Local official `eval_tpc.py` currently computes `0.1*micro_comm + 0.1*micro_comm + 0.25*C-LPR + 0.4*FPR + preference`, while the published evaluation guide names the second 10% term EPR-macro. Treat the local official code as executable truth for the current run, and re-check before submission.

## Tool / Skill Decision

Current eval-derived order:

1. `P0 guide_tpc_eval_analysis`: implemented runtime tool for reproducible stage-matrix analysis.
2. `P0 residual chronology repair`: fix the one remaining commonsense failure without reducing route, budget and entity gains.
3. `P0 other.unclassified classifier`: split time-window and duration constraints into targeted repair classes.
4. `P1 intercity mode repair`: finish remaining train/airplane mode and intercity-budget failures while preserving official route validity.
5. `P1 residual entity repair`: finish remaining accommodation/restaurant/attraction name/type failures, including forbid/choice edge cases.
6. `P2 preference optimizer`: tune DAV/ATT/DDR only after hard pass rate plateaus.

Reject score-chasing work that cites only aggregate `overall` without a stage breakdown.
