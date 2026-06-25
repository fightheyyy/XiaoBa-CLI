---
name: data-profiling
description: Profile ChinaTravel TPC task and environment data before deciding Guide tools, skills, or repair strategy.
aliases:
  - tpc-data-profile
  - chinatravel-data-profile
  - guide-data-analysis
user-invocable: true
auto-invocable: true
---

# Data Profiling

Use this skill before adding Guide runtime tools, changing prompts, or designing repair loops for ChinaTravel / TPC.

## Required Inputs

```text
phase1_en_tasks = /Users/guowei/minimind/data/ijcai2026_chinatravel/TPC_IJCAI_2026_phase1_EN/
database_zh = /Users/guowei/minimind/data/chinatravel_database/extract_zh/database
database_en = /Users/guowei/minimind/data/chinatravel_database/extract_en/database_en
```

## Workflow

1. Count task files and validate task keys.
2. Profile `days`, `people_number`, `start_city`, `target_city`, and route distribution.
3. Parse `hard_logic_py` into constraint classes:
   - core shape: day count, people count, tickets, taxi cars;
   - entity constraints: attraction / restaurant / accommodation name and type;
   - budget constraints: attraction, restaurant, accommodation, intercity, innercity, total;
   - transport constraints: train, airplane, taxi, metro, walk;
   - room and same-accommodation constraints.
4. Profile official databases:
   - city coverage;
   - row counts for attractions, restaurants, accommodations, trains, airplanes, subway;
   - entity name/type exact-match coverage against extracted constraints.
5. Write a profile artifact under `output/guide/data-profile/<run_id>/`.
6. Decide tool and skill priority from the data profile, not from prompt intuition.

## Current Phase 1 Profile

Current profile artifact:

```text
output/guide/data-profile/phase1-en-v0/profile.md
output/guide/data-profile/phase1-en-v0/profile.json
```

Key findings:

- 1000 EN tasks.
- days distribution: 2-day 379, 3-day 370, 4-day 221, 5-day 30.
- people distribution: 1 person 213, 2 people 200, 3 people 218, 4 people 271, 5 people 98.
- hard logic per task: 474 tasks have 1 constraint, 62 have 5, 464 have 6.
- 1073 unique normalized `hard_logic_py` strings.
- top hard-constraint classes by task count: day/people/ticket/taxi shape 526 each, intercity cost 122, total cost 120, innercity transport type 118, attraction cost 116, room type 109.
- database_en coverage: 3413 attractions, 4669 restaurants, 3866 accommodations, 90 train route files, 720 airplane rows, subway data present.
- historical schema-only official verifier scorecard: overall 4.2016, FPR 0.
- current v12 verifier-filtered repair scorecard: overall 90.3290, FPR 93.8.
- current eval analysis: schema 1000/1000, commonsense/environment 999/1000, raw hard logic 938/1000 full-pass, all-pass 938/1000.

## Tool / Skill Decision

Current data + eval-driven order:

1. `P0 guide_tpc_data_profile`: make this profile reproducible instead of ad hoc.
2. `P0 guide_tpc_eval_analysis`: implemented runtime tool that makes verifier stage breakdown reproducible instead of relying on aggregate score.
3. `P0 environment entity binder`: select official city-scoped attractions, restaurants, accommodations, and positions.
4. `P0 hard_logic constraint parser`: convert `hard_logic_py` into typed constraint objects that drive binder choices.
5. `P1 intercity route selector`: select train/airplane records from official transport data.
6. `P1 budget solver`: check and allocate costs before verifier runs.
7. `P1 failure taxonomy extractor`: turn verifier output into uid/category repair queues.
8. `P2 LLM itinerary writer`: keep LLM generation behind deterministic parser/binder/solver.

Reject new Guide prompt or LLM-generation work when it is not backed by an updated data profile.
Reject repair work that cites only `overall` without the latest eval-analysis artifact.
