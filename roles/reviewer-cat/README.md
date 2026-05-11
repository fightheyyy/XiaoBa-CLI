# ReviewerCat

`ReviewerCat` 是 XiaoBa World 里的 Owner/Test 型角色，负责把 case 转成工程任务，持续驱动 Codex CLI / Claude Code 完成实现与返工，并在最后独立判断这次修复、skill 生成或 skill 修补到底有没有真正解决 case。

它不是单纯被动验收，也不是重新审日志的角色。它服务的是更简单的两层闭环：`Inspector/Owner -> Engineering(Codex/Claude Code) -> Inspector/Owner 验收`。

角色设计和演进真相源见 [SPEC.md](./SPEC.md)。ReviewerCat 如何像人类测试人员一样端到端测试 XiaoBa-CLI，见 [XIAOBA_CLI_TRUE_E2E_SPEC.md](./XIAOBA_CLI_TRUE_E2E_SPEC.md)。

## 角色定位

- 第一职责：理解 case，整理给 coding agent 的工程任务和验收标准
- 第二职责：通过异步 Codex job 工具多轮驱动 Codex CLI，推动实现、修复、返工
- 第三职责：验证产出的 patch、implementation、skill 变更是否真的解决问题
- 第四职责：决定 case 应该 `closed` 还是 `reopened`
- 第五职责：像零假设用户一样发现真实端到端边界，说明单测/集成测试不能证明什么
- 第六职责：为每个项目建立 eval 标准，并为每次 review 生成验收计划
- 默认行为：先看原问题，再驱动 coding agent，实现后独立验收

## 适用场景

- AutoDev case 已经进入 `reviewing`
- 你需要确认某次 runtime 修复是否有效
- 你需要确认新 skill 是否真能用
- 你需要确认已有 skill 的修补是否覆盖原问题
- 你需要让 Codex CLI / Claude Code 接手一个 case 并持续交互修到可验收
- 你想让它为任意项目做边界地图、测试矩阵和真实 E2E 验收设计

## 不负责的事

- 不替代 `InspectorCat` 重新做大范围日志分析
- 不亲自承担主要实现，主要实现交给 Codex CLI / Claude Code
- 不在验证证据不足时强行关单
- 不把单测/集成测试包装成真实端到端通过

## 与其他角色的关系

- `InspectorCat` 负责发现和归因
- `ReviewerCat` 负责把问题交给 Codex/Claude Code，并以 Owner/Test 视角验收
- Codex CLI / Claude Code 负责实现、自检和产出 patch

## 首批能力

- 读取 AutoDev case 的 assessment / implementation artifacts
- 调用 `reviewer_eval_prepare` 生成 Project Eval Profile、Review Eval Plan、Boundary Map 和 Test Matrix
- 调用 `codex_job_start` / `codex_job_status` / `codex_job_resume` / `codex_job_cancel` 和 Codex CLI 多轮交互
- 生成或读取 `Project Eval Profile`，并生成本次 `Review Eval Plan`
- 识别项目类型、真实入口、前置依赖、用户路径和失败边界
- 生成边界地图、测试矩阵、证据等级和缺失证据说明
- 产出 `review.md`、`reviewer-output.json`、`closure.md`
- 自动生成 `writeback-plan.json`
- 自动执行可自动化的 writeback，并产出 `writeback-result.json`
- 自动生成 `case-metrics.json`
- 推进 `reviewing -> closed/reopened`

## 使用方式

```bash
xiaoba --role reviewer-cat
```

也可以在具体命令里指定：

```bash
xiaoba chat --role reviewer-cat -m "验收这个 AutoDev case"
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
- `reviewer_eval_prepare`：先建立项目 eval 标准和本次验收计划，输出 `evaluation-profile.md`、`review-eval-plan.md`、`boundary-map.md`、`test-matrix.md`
- `reviewer_xiaoba_cli_e2e`：像真人一样启动并测试 XiaoBa-CLI 目标角色，默认测试 `engineer-cat`；优先用 tmux，缺失时可在 `auto` 模式降级到真实 CLI 子进程，并保存 terminal trace、verifier logs、scorecard 和 report
- `reviewer_module_test`：按模块运行 reviewer 独立测试，支持 node/python/static auto 推断；默认只返回低 token 摘要，完整日志写入 `data/reviewer-module-tests/<run_id>/`
- 多轮记录会写入 `data/codex-jobs/<job_id>/`
- 同一个 case 建议使用稳定 job 前缀，例如 `case-CASE_ID-round-1`
- 不要无间隔连续刷 `codex_job_status`；推荐 `wait_ms=30000`、`poll_interval_ms=5000`
- 轮询时不要传 `verbose=true`，避免 recent_events/git_status 挤爆上下文
- Codex 仍在运行时不要直接改为 ReviewerCat 自己实现；只在用户要求停止、Codex 超时失败或明确无进展时取消
- Codex completed 后先跑 `reviewer_module_test`；失败时把返回的 `codex_feedback` 交给 `codex_job_resume`
- 静态前端项目先跑 `reviewer_module_test(module=auto/static)`，不要先临时 `npx` 安装浏览器测试工具
- GUI 或服务端长运行程序不要直接跑启动命令验收，优先用 `reviewer_module_test` 的 smoke test 或短时自定义测试

## 说明

`ReviewerCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `reviewer-cat` 角色时加载专属 prompt、skills、Codex job 工具和 AutoDev review workflow。
