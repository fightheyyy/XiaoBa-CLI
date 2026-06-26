# ReviewerCat

`ReviewerCat` 是 XiaoBa World 里的真人端测 Owner，负责把 case 转成工程任务，持续驱动 Codex CLI / Claude Code 完成实现与返工，并在最后像真实用户一样从入口使用候选产物，独立判断这次修复、skill 生成或 skill 修补到底有没有真正解决 case。

它不是单纯被动验收，也不是重新审日志的角色。它服务的是更简单的两层闭环：`Inspector/Owner -> Engineering(Codex/Claude Code) -> Inspector/Owner 验收`。

角色设计和演进真相源见 [SPEC.md](./SPEC.md)。Benchmark / replay 的通用规则收敛到 [eval/benchmarks/SPEC.md](../../eval/benchmarks/SPEC.md)，role-specific benchmark 应维护在对应 `eval/benchmarks/<Role>/` 或 role-local docs 中。

## 角色定位

- 第一职责：理解 case，整理给 coding agent 的工程任务和验收标准
- 第二职责：通过异步 Codex job 工具多轮驱动 Codex CLI，推动实现、修复、返工
- 第三职责：通过真实入口端到端验证产出的 patch、implementation、skill 变更是否真的解决问题
- 第四职责：决定 case 应该 `closed` 还是 `reopened`
- 第五职责：像零假设用户一样发现真实端到端边界，说明单测/集成测试不能证明什么
- 第六职责：为每个项目建立 eval 标准，并为每次 review 生成验收计划
- 第七职责：按 Durable Session / Working Trace / Provider Transcript 三层原则验收 agent harness
- 第八职责：为 XiaoBa-CLI 所有目标 roles 设计 role effectiveness rubric、scorecard 和缺失证据清单
- 默认行为：先看原问题，再驱动 coding agent，实现后独立验收

## 适用场景

- case artifact 需要按 `reviewing` contract 验收
- 你需要确认某次 runtime 修复是否有效
- 你需要确认新 skill 是否真能用
- 你需要确认已有 skill 的修补是否覆盖原问题
- 你需要让 Codex CLI / Claude Code 接手一个 case 并持续交互修到可验收
- 你想让它为任意项目做边界地图、真人端测场景矩阵和真实 E2E 验收设计

## 不负责的事

- 不替代 `InspectorCat` 重新做大范围日志分析
- 不亲自承担主要实现，主要实现交给 Codex CLI / Claude Code
- 不负责单元测试、集成测试、红绿测试、lint、typecheck、build 或常规 CI；这些属于 EngineerCat / 工程流水线
- 不在验证证据不足时强行关单
- 不把单测/集成测试包装成真实端到端通过

## 与其他角色的关系

- `InspectorCat` 负责发现和归因
- `ReviewerCat` 负责把问题交给 Codex/Claude Code，并以 Owner/Test 视角验收
- Codex CLI / Claude Code 负责实现、自检和产出 patch

## 首批能力

- 读取 case artifact 的 assessment / implementation artifacts
- 调用 `reviewer_eval_prepare` 生成 Project Eval Profile、Review Eval Plan、Boundary Map 和真人端测场景矩阵
- 调用 `codex_job_start` / `codex_job_status` / `codex_job_resume` / `codex_job_cancel` 和 Codex CLI 多轮交互
- 生成或读取 `Project Eval Profile`，并生成本次 `Review Eval Plan`
- 识别项目类型、真实入口、前置依赖、用户路径和失败边界
- 生成边界地图、真人端测场景矩阵、证据等级和缺失证据说明
- 对 agent runtime 改动生成三层状态检查项，避免把 session、trace、provider transcript 混成一个 messages 列表
- 对 XiaoBa-CLI roles 生成 role effectiveness 评分维度，用真实入口和独立证据验证 InspectorCat / EngineerCat / ReviewerCat / ResearcherCat 等角色是否有效
- 产出 `review.md`、`reviewer-output.json`、`closure.md`
- 需要写回时描述建议的 writeback 计划；当前运行时不自动执行 writeback executor
- 自动生成 `case-metrics.json`
- 推进 `reviewing -> closed/reopened`

## 使用方式

```bash
xiaoba --role reviewer-cat
```

也可以在具体命令里指定：

```bash
xiaoba chat --role reviewer-cat -m "验收这个 case artifact"
xiaoba chat --role reviewer-cat -m "判断这个修复要不要关单"
xiaoba chat --role reviewer-cat -m "用 codex cli 继续修这个 case，直到能验收"
xiaoba skill list --role reviewer-cat
```

## Coding Agent 工具

启用 `reviewer-cat` 角色后会额外加载：

- `codex_job_start`：后台启动 `codex exec --json`，立即返回 `job_id`
- `codex_job_status`：查询 job 状态；默认只返回 Codex 是否还在跑、session、最新 output/error，可传 `wait_ms` / `poll_interval_ms` 做带等待窗口的间隔轮询，只有排查时传 `verbose=true` 返回完整事件/git status
- `codex_job_resume`：基于 `codex_session_id` 或 `parent_job_id` 追加一轮返工任务
- `codex_job_cancel`：取消正在运行的 job，Windows 下会尝试杀进程树
- `reviewer_eval_prepare`：先建立项目 eval 标准和本次验收计划，输出 `evaluation-profile.md`、`review-eval-plan.md`、`boundary-map.md`、`test-matrix.md`；这里的 test matrix 是真人端测场景矩阵。对 XiaoBa-CLI 会额外生成三层状态检查和 role effectiveness rubric
- `reviewer_xiaoba_cli_e2e`：像真人一样启动并测试 XiaoBa-CLI 目标角色，默认测试 `engineer-cat`；优先用 tmux，缺失时可在 `auto` 模式降级到真实 CLI 子进程，并保存 terminal trace、verifier logs、three-layer evidence、role effectiveness scorecard 和 report
- `reviewer_module_test`：历史/辅助证据入口，用于读取或生成低层验证摘要；不是 ReviewerCat 默认验收步骤
- 多轮记录会写入 `data/codex-jobs/<job_id>/`
- 同一个 case 建议使用稳定 job 前缀，例如 `case-CASE_ID-round-1`
- 不要无间隔连续刷 `codex_job_status`；推荐 `wait_ms=30000`、`poll_interval_ms=5000`
- 轮询时不要传 `verbose=true`，避免 recent_events/git_status 挤爆上下文
- Codex 仍在运行时不要直接改为 ReviewerCat 自己实现；只在用户要求停止、Codex 超时失败或明确无进展时取消
- Codex completed 后读取实现、验证摘要和 artifacts，再按 Review Eval Plan 跑真人端测
- 低层测试缺失或失败时，把它作为前置风险反馈给 EngineerCat / Codex；不要把低层测试当 closure
- GUI、Dashboard、Pet、IM、CLI 项目优先通过真实入口或短时 E2E harness 模拟真人使用

## 说明

`ReviewerCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `reviewer-cat` 角色时加载专属 prompt、skills、Codex job 工具和 case artifact review workflow。
