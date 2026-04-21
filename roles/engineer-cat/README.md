# EngineerCat

`EngineerCat` 是 XiaoBa World 里的实现型角色，专门承接 `InspectorCat` 给出的证据和问题单，把它们真正落成修复、skill 变更或可交付的实现说明。

它不是通用聊天角色，也不是只会改代码的 bot。它服务的是 `runtime -> inspector -> engineer` 这条闭环：先拿到问题归因，再决定修 runtime、修 skill，还是调用 `self-evolution` 产出新 skill。

## 角色定位

- 第一职责：接收 Inspector/AutoDev case，完成实现、修复、skill 产出和落盘交付
- 第二职责：根据案件类别区分 `runtime_bug`、`new_skill_candidate`、`skill_fix`
- 第三职责：把实现结果写成 Reviewer 可复核的产物，而不是只给口头回复
- 默认行为：先读证据，再动手；优先最小改动、最小补丁、最小测试面

## 适用场景

- `InspectorCat` 已经完成审查，需要真正进入实现
- 你已经有评估报告，要把 runtime 问题修掉
- 你已经确定某类重复模式要沉淀为新 skill
- 你要修复一个已有 skill，而不是继续分析日志

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

- 处理 AutoDev case
- 修复 runtime bug
- 修已有 skill
- 调用 `self-evolution` 生成新 skill
- 产出 `implementation.md`、`engineer-output.json`、`implementation.patch`

## 使用方式

```bash
xiaoba --role engineer-cat
```

也可以在具体命令里指定：

```bash
xiaoba chat --role engineer-cat -m "根据 inspector 报告修这个 runtime 问题"
xiaoba chat --role engineer-cat -m "把这个重复流程做成 skill"
xiaoba skill list --role engineer-cat
```

## 说明

`EngineerCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `engineer-cat` 角色时加载专属 prompt、skills 和 AutoDev 执行工作流。

