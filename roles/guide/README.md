# Guide

`Guide` is XiaoBa's ChinaTravel / TPC competition role.

Its job is to build practical travel-planning prediction baselines for the Agentic AI travel planning competition: read English natural-language trip requests, produce structured China multi-day itinerary JSON, run the official verifier, repair failures, and package prediction files for Phase 1 submission.

## Responsibility

- Treat official verifier pass rate as the main product metric.
- Produce schema-valid itinerary JSON before optimizing language style.
- Use the local Phase 1 EN dataset:

```text
/Users/guowei/minimind/data/ijcai2026_chinatravel/TPC_IJCAI_2026_phase1_EN/
```

- Keep Phase 1 focused on prediction files and zip packaging.
- Prepare Phase 2 design notes for a self-contained harness that can run under the organizer model/runtime constraints.
- Turn verifier failures into repair examples, prompt improvements, or later SFT/RL data.

## Boundaries

Guide must not:

- treat a pretty natural-language itinerary as a valid submission;
- claim success without official verifier evidence;
- train or fine-tune a small model before a baseline verifier loop exists;
- submit code/model artifacts for Phase 1;
- mutate official ChinaTravel evaluation code except in an isolated copy for debugging;
- mark Phase 2 readiness until a self-contained harness can reproduce the local loop.

## Baseline Loop

```text
phase1 task JSON
  -> constraint extraction
  -> itinerary JSON draft
  -> schema validation
  -> official eval_tpc.py verifier
  -> targeted repair
  -> prediction file
  -> submission zip
```

Local official evaluation command shape:

```bash
python eval_tpc.py --splits <current_split> --method <method_name> --lang en
```

The expected result directory shape follows the official runner:

```text
results/<method_name>_en/<uid>.json
```

## Usage

```bash
xiaoba chat --role guide -m "先给 TPC Phase 1 做一个 schema-valid + verifier-repair baseline plan"
```

Executable schema baseline tool:

```text
guide_tpc_baseline(dataset_dir?, run_id?, method_name?, team_name?, version?, official_repo_dir?, run_verifier?)
```

Executable environment + repair baseline tool:

```text
guide_tpc_env_baseline(official_repo_dir, dataset_dir?, run_id?, method_name?, split?, limit?, python_bin?, run_verifier?, include_zip?)
```

Current data profile artifact:

```text
output/guide/data-profile/phase1-en-v0/profile.md
output/guide/data-profile/phase1-en-v0/profile.json
```

Historical schema-only baseline artifact:

```text
output/guide/tpc-baseline/phase1-schema-baseline-v0/
```

It generated 1000/1000 local schema-valid predictions and:

```text
output/guide/tpc-baseline/phase1-schema-baseline-v0/XiaoBaGuide_v0.zip
```

Historical schema-only official verifier smoke:

```text
MicEPR 21.008, MacEPR 0, C-LPR 0, FPR 0, DAV 0, ATT 0, DDR 0, overall 4.2016
```

Current v12 Phase 1 candidate:

```text
output/guide/tpc-env-baseline/phase1-v12-quoteparse-full/
output/guide/tpc-env-baseline/phase1-v12-quoteparse-full/XiaoBaGuide_venv12.zip
```

Current official verifier score:

```text
MicEPR 99.996, MacEPR 99.9, C-LPR 98.0661, FPR 93.8, DAV 1.7546, ATT 95.2431, DDR 68.8682, overall 90.3290
```

Current eval analysis artifact:

```text
output/guide/eval-analysis/phase1-v12-quoteparse-full/eval-analysis.md
output/guide/eval-analysis/phase1-v12-quoteparse-full/eval-analysis.json
```

Eval finding:

```text
Schema passed 1000/1000, commonsense/environment passed 999/1000, raw hard logic passed 938/1000 full tasks, and all-pass/FPR reached 938/1000.
```

Recommended next production step:

```text
Classify other.unclassified time-window/duration failures, fix the one remaining chronology edge case, and continue budget / residual entity repair before preference tuning or model training.
```
