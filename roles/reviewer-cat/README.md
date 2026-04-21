# ReviewerCat

`ReviewerCat` 是 XiaoBa World 里的验收型角色，专门承接 `EngineerCat` 的实现结果，判断这次修复、skill 生成或 skill 修补到底有没有真正解决 case。

它不是重新做实现的角色，也不是重新审日志的角色。它服务的是 `runtime -> inspector -> engineer -> reviewer` 这条闭环里的最后判断：关单还是打回，回写还是暂缓。

## 角色定位

- 第一职责：验证 `EngineerCat` 产出的 patch、implementation、skill 变更是否真的解决问题
- 第二职责：决定 case 应该 `closed` 还是 `reopened`
- 第三职责：在 closed 时补齐回写策略、执行可自动化回写、沉淀闭环指标
- 默认行为：先看证据、再看实现、最后下 closure decision

## 适用场景

- AutoDev case 已经进入 `reviewing`
- 你需要确认某次 runtime 修复是否有效
- 你需要确认新 skill 是否真能用
- 你需要确认已有 skill 的修补是否覆盖原问题

## 不负责的事

- 不替代 `InspectorCat` 重新做大范围日志分析
- 不替代 `EngineerCat` 重新做大规模实现
- 不在验证证据不足时强行关单

## 与其他角色的关系

- `InspectorCat` 负责发现和归因
- `EngineerCat` 负责实现和交付
- `ReviewerCat` 负责验收、关单、重开、回写计划和指标沉淀

## 首批能力

- 读取 AutoDev case 的 assessment / implementation artifacts
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
xiaoba skill list --role reviewer-cat
```

## 说明

`ReviewerCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `reviewer-cat` 角色时加载专属 prompt、skills 和 AutoDev review workflow。
