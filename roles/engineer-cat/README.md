# EngineerCat

`EngineerCat` 是 XiaoBa World 里的实现型角色，既承接 `InspectorCat` 给出的证据和问题单，把它们真正落成修复、skill 变更或可交付的实现说明，也可以作为日常工程里的 Codex runner 调用人，通过已验证的本机 Codex CLI 后台任务完成需求，并能用 supervisor 管理多个 Codex workers。

它不是只会改代码的 bot。它服务两条线：一条是 `runtime -> inspector -> engineer -> reviewer` 的证据闭环；另一条是用户日常开发时，把任务交给 `EngineerTaskRunner` / Codex job，再综合结果完成交付。

角色设计和演进真相源见 [SPEC.md](./SPEC.md)，当前执行计划见 [PLAN.md](./PLAN.md)。

## 角色定位

- 第一职责：接收 Inspector handoff / case artifact，完成实现、修复、skill 产出和落盘交付
- 第二职责：根据案件类别区分 `runtime_bug`、`new_skill_candidate`、`skill_fix`
- 第三职责：把实现结果写成 Reviewer 可复核的产物，而不是只给口头回复
- 默认行为：先读证据，再动手；优先最小改动、最小补丁、最小测试面
- 日常工程行为：优先使用 `engineer_task_run` / `engineer_task_status` / `engineer_task_resume` 创建、追踪和恢复 Codex 后台任务；多模块或可并行任务使用 `engineer_codex_supervisor_*` 管理 worker 队列、依赖、并发和聚合证据
- Coding agent 协作行为：把用户需求改写成高质量 Codex prompt，约束范围和产物，并负责评估、追问和整合结果
- IM 交互行为：主会话保持可响应，长任务优先通过 `engineer_task_run` 创建可追踪后台任务；需要隔离长对话时再派 `spawn_subagent`

## 适用场景

- `InspectorCat` 已经完成审查，需要真正进入实现
- 你已经有评估报告，要把 runtime 问题修掉
- 你已经确定某类重复模式要沉淀为新 skill
- 你要修复一个已有 skill，而不是继续分析日志
- 你想让 XiaoBa 调用 Codex 做代码审查、架构分析或测试策略
- 你想让 XiaoBa 把工程任务变成可追踪、可验证、可恢复的后台 Codex job
- 你想让一个 EngineerCat 同时管理多个 Codex sessions，并统一处理依赖、状态、返工、取消和交付汇总
- 你在 IM 里直接把需求交给 EngineerCat，希望它后台跑实现，期间仍能查进度、停掉或补充要求

## 不负责的事

- 不重新充当 `InspectorCat` 做长日志审查
- 不在证据缺失时凭猜测大改代码
- 不自我关闭 case
- 不把一次性临时操作误做成新 skill

## 与其他角色的关系

- `InspectorCat` 负责找问题、给证据、给归因
- `EngineerCat` 负责把问题转成修复、skill 或实现交付
- 后续 `Reviewer / Verifier` 负责验收、关闭或重开 case

## 首批能力

- 处理 Inspector handoff / case artifact
- 修复 runtime bug
- 修已有 skill
- 调用 `self-evolution` 生成新 skill
- 使用 `engineer_task_run` / `engineer_task_status` / `engineer_task_resume` / `engineer_task_cancel` 把日常工程需求变成可追踪后台任务
- 使用 `engineer_codex_supervisor_start` / `engineer_codex_supervisor_status` / `engineer_codex_supervisor_resume` / `engineer_codex_supervisor_cancel` 把多 worker Codex 任务变成可追踪 supervisor run
- Codex 完成后可按显式 `validation_commands` 或基础 quality gate 推断自动运行验证，并把结果写入 `validation.md`
- 多 worker 任务会聚合 `supervisor.json`、`plan.md`、worker validation/final summary 和 `aggregate.md`
- 查询项目下已有 Codex sessions，并指定 `codex_session_id` resume 到某个项目的 Codex 会话继续交互
- 组织 coding-agent prompt，并读取、批判、整合 Codex job 产物
- 使用 `engineer-task-runner` skill 承接 subagent 后台工程任务
- 主会话可查询、停止、恢复后台子任务；子任务可通过 `ask_parent` 挂起确认，并在完成后由主会话综合交付
- 产出 `implementation.md`、`engineer-output.json`、`implementation.patch`

## 使用方式

```bash
xiaoba --role engineer-cat
xiaoba --role engineer
```

也可以在具体命令里指定：

```bash
xiaoba chat --role engineer-cat -m "根据 inspector 报告修这个 runtime 问题"
xiaoba chat --role engineer-cat -m "把这个重复流程做成 skill"
xiaoba chat --role engineer -m "让 Codex 审一下这个模块的架构风险"
xiaoba chat --role engineer -m "把这个实现任务开成可追踪 Codex 后台任务"
xiaoba chat --role engineer -m "把 runtime、eval、docs 拆成多个 Codex worker 并统一汇总"
xiaoba skill list --role engineer-cat
```

## 说明

`EngineerCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `engineer-cat` 角色时加载专属 prompt、skills、Codex runner 工具和 case handoff 工作流。
