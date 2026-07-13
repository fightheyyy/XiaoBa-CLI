# XiaoBa Roles

XiaoBa 只有一个面向用户的 Base Main Agent。Role 是 Base 派遣的专业 Subagent 配置，全部复用同一套 XiaoBa Agent Runtime。

架构和进度统一维护在 [`docs/roles-skills/SPEC.md`](../docs/roles-skills/SPEC.md) 与 [`docs/roles-skills/PLAN.md`](../docs/roles-skills/PLAN.md)。

## 默认七个角色

| Role | 责任 | 不负责 |
| --- | --- | --- |
| `user-cat` | 低信息用户压力、候选 trace | 判断通过、修代码 |
| `inspector-cat` | 发现问题、整理证据、路由 | 实现修复、最终验收 |
| `reviewer-cat` | 复跑、验收、closed/reopened/blocked | 主实现 |
| `engineer-cat` | 代码与工程环境接管、实现返工 | 浏览器/桌面专属操作 |
| `browser-cat` | 浏览器接管和页面证据验证 | 桌面 GUI、任意 Shell |
| `gui-cat` | macOS 桌面 GUI 接管和操作证据 | 浏览器专属流程、任意 Shell |
| `secretary-cat` | 飞书日历、消息、邮件、任务、文档和协同工作流；可用 `feishu-cat` / `FeishuCat` 别名 | 重写飞书 API/CLI、绕过确认直接执行后果动作 |

稳定协作关系：

```text
UserCat -> InspectorCat -> EngineerCat -> ReviewerCat
                                      ^          |
                                      | reopened |
                                      +----------+
```

## 使用

```bash
xiaoba role list
xiaoba role info engineer-cat
xiaoba --role engineer-cat
xiaoba --role browser-cat
xiaoba --role gui-cat
xiaoba --role feishu-cat
xiaoba chat --role user-cat -m "像普通用户一样试用这个功能"
```

SecretaryCat 复用[官方 larksuite/cli](https://github.com/larksuite/cli)执行飞书能力。XiaoBa 只在它上面增加角色派遣、领域工具收窄、后果动作确认、交付和 evidence；使用前需在本机安装并配置官方 `lark-cli`。

Base 派遣跨角色工作时使用 `role_name`，目标角色自行选择其可见 Skill。`base`、`default`、`none` 表示不激活角色。

## Role 包结构

```text
roles/<role-name>/
  role.json
  prompts/<prompt-file>.md
  skills/<skill-name>/SKILL.md   # optional
```

- `role.json`：名称、描述、prompt、skill/tool policy 和确认 gate。
- `prompts/**`：运行时角色指令，不是用户文档。
- `skills/**/SKILL.md`：角色工作方法，不拥有独立 Agent loop。
- 原生角色工具位于 `src/roles/**`，必须经过共享 ToolManager。

非默认角色通过显式安装或本地资产进入，不自动加入 GitHub 默认跟踪和 Electron 默认包。
