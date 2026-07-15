# XiaoBa Roles

XiaoBa 只有一个面向用户的 Base Main Agent。Role 是 Base 派遣的专业 Subagent 配置，全部复用同一套 XiaoBa Agent Runtime。

架构和进度统一维护在 [`docs/roles-skills/SPEC.md`](../docs/roles-skills/SPEC.md) 与 [`docs/roles-skills/PLAN.md`](../docs/roles-skills/PLAN.md)。

## 默认八个角色：4 个功能型 + 4 个内部持续改进

八个 Role 全部复用同一套 XiaoBa Agent Runtime。分组表达的是责任和启动方式，不是两套控制平面。

### 4 个功能型 Role

| Role | 责任 | 不负责 |
| --- | --- | --- |
| `engineer-cat` | 代码与工程环境接管、实现返工 | 浏览器/桌面专属操作 |
| `browser-cat` | 浏览器接管和页面证据验证 | 桌面 GUI、任意 Shell |
| `gui-cat` | macOS 桌面 GUI 接管和操作证据 | 浏览器专属流程、任意 Shell |
| `secretary-cat` | 飞书日历、消息、邮件、任务、文档和协同工作流；可用 `feishu-cat` / `FeishuCat` 别名 | 重写飞书 API/CLI、绕过确认直接执行后果动作 |

### 4 个内部持续改进 Role

| Role | 责任 | 不负责 |
| --- | --- | --- |
| `user-cat` | 作为内部 evaluation actor 施加低信息用户压力并生产候选 trace | 判断通过、修代码、替代 nightly 真实 trace |
| `inspector-cat` | 发现问题、整理证据并输出类型化 route | 实现修复、生成候选、最终验收 |
| `evolution-cat` | 确定性长期记忆、Inspector finding 后的候选 Skill/Role 沉淀和显式发布 | 原始 trace 诊断、编写 runtime 代码、自评通过、跨角色调度 |
| `reviewer-cat` | 正式回放、独立验收、`closed / next_run / blocked` | 主实现、同次回跳修复 |

内部四个 Role 按 workflow 场景启动，并不构成每次全部执行的线性链。nightly 从 InspectorCat 开始；UserCat 主要用于按需测试和 Arena 场景；EvolutionCat、ReviewerCat 按 route 参与；`repair` 可以调用功能型的 EngineerCat。

稳定协作关系：

```text
Session Traces -> InspectorCat -> evolution -> EvolutionCat -> Arena
                              -> repair    -> EngineerCat -> ReviewerCat
                              -> replay    -------------> ReviewerCat
                              -> no_op     -> terminal
```

## 使用

```bash
xiaoba role list
xiaoba role info engineer-cat
xiaoba --role engineer-cat
xiaoba --role browser-cat
xiaoba --role gui-cat
xiaoba --role feishu-cat
xiaoba --role evolution-cat
xiaoba chat --role user-cat -m "像普通用户一样试用这个功能"
xiaoba evolution sleep --harvest-only
xiaoba evolution schedule install  # macOS only
```

内置自动 schedule 当前仅支持 macOS 的每日 cron；其他平台可显式运行 `xiaoba evolution sleep`。

SecretaryCat 复用[官方 larksuite/cli](https://github.com/larksuite/cli)执行飞书能力。XiaoBa 只在它上面增加角色派遣、领域工具收窄、后果动作确认、交付和 evidence；使用前需在本机安装并配置官方 `lark-cli`。

Base 派遣跨角色工作时使用 `role_name`，目标角色自行选择其可见 Skill。`base`、`default`、`none` 表示不激活角色。

`xiaoba evolution sleep` 是夜间入口：runtime 从本地 terminal traces 生成一次 digest，InspectorCat 先诊断并输出类型化 route；`evolution` 交给 EvolutionCat 生成隔离 Candidate Skill/Role 并进入 Arena，`repair` 交给 EngineerCat 后由 ReviewerCat 回放，`replay` 直接交给 ReviewerCat，`no_op` 显式终止。Base 不参与这条定时链路。macOS 上的 `schedule install` 默认按本地时间 03:17 安装当前项目专属的幂等 crontab block；`status` / `remove` 用于检查和移除。

## Role 包结构

```text
roles/<role-name>/
  role.json
  prompts/<prompt-file>.md
  skills/<skill-name>/SKILL.md   # optional
```

- `role.json`：名称、描述、prompt、skill/tool policy 和确认 gate。
- 新建的非默认 Role 必须在 `role.json` 写 `"status": "candidate"`；通过 Arena/人工验收并显式 Promote 后才改为 `active`。缺省 `active` 只兼容旧资产。
- `prompts/**`：运行时角色指令，不是用户文档。
- `skills/**/SKILL.md`：角色工作方法，不拥有独立 Agent loop。
- 原生角色工具位于 `src/roles/**`，必须经过共享 ToolManager。

非默认角色通过显式安装或本地资产进入，不自动加入 GitHub 默认跟踪和 Electron 默认包。
