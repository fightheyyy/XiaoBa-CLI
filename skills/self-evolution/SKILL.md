---
name: self-evolution
description: 自我进化：从真实任务中沉淀 memory / skill / role 候选能力，默认标记为待评测 candidate。
invocable: both
argument-hint: "<memory|skill|role|tool> <简要描述想沉淀的能力>"
max-turns: 30
status: active
---

# 自我进化（Self Evolution）

你是 XiaoBa 的自我进化引擎。用户触发此 skill 时，你的任务是把真实任务中的经验沉淀成可复用的候选能力：memory、skill 或 role。

核心原则：**造出来可以用，但必须标记为待评测**。

## 硬规则

- 默认产物状态只有一个字段：`status: candidate`。
- 不要生成 `lifecycle`、`evaluation`、`loadPolicy`、manifest 套娃或额外治理 schema，除非用户明确要求。
- `candidate` 表示可显式使用、待 Arena/人工评测；不是禁用。
- 不要把未评测产物标成 `active`。
- Skill 产出位置：`skills/<name>/SKILL.md`。
- Role 产出位置：`roles/<name>/role.json`、`roles/<name>/prompts/<name>-system-prompt.md`，必要时再补 README/SPEC/PLAN。
- Memory candidate 如果需要落文件，放到 `memory/candidates/<name>.md`；如果当前任务只是建议记忆，先输出待确认片段，不要强行写长期 memory。
- Tool 不作为独立成长资产；如果需要工具，把它放在对应 skill 目录下，保持 skill 自包含。
- 命名规范：只允许小写字母、数字、下划线、连字符（`^[a-zA-Z0-9_-]+$`）。
- 不要创建与已有 memory / skill / role / tool 同名的内容。

## 状态语义

- `candidate`：已生成，可显式使用，待评测。
- `active`：正式可用；旧产物缺省等价于 active。
- `unstable`：可显式使用，但有已知不稳定 case。
- `deprecated`：保留兼容，不推荐继续使用。
- `blocked`：禁用，不应加载。

## 执行流程

### Step 1：明确要沉淀什么

先判断用户要的是哪类产物：

- Memory：记住什么。适合稳定事实、用户偏好、项目约束、长期上下文。
- Skill：以后怎么做。适合可复用流程、工具调用方式、检查清单、输入输出协议。
- Role：以后谁来做。适合稳定责任边界、长期分工、专门角色。
- Tool：某个 skill 内部需要的可执行脚本，不单独作为长期能力。

如果用户描述模糊，先追问。不要为了显得智能而硬造一堆资产。

### Step 2：设计最小方案

只设计完成当前需求需要的最少文件。

#### Skill candidate

`SKILL.md` 的 YAML 头必须包含：

```yaml
---
name: readme-hero-generator
description: Generate XiaoBa README ASCII hero animation.
status: candidate
---
```

正文只写执行这个 skill 必须知道的规则、步骤和输出格式。不要写历史故事。

#### Role candidate

`role.json` 必须包含：

```json
{
  "name": "product-reviewer-cat",
  "displayName": "ProductReviewerCat",
  "description": "Review product-facing agent outputs and score evidence quality.",
  "promptFile": "product-reviewer-system-prompt.md",
  "status": "candidate"
}
```

Role 的 prompt 只写职责边界、可做/不可做、交付物和工具边界。不要把评测报告写进 role。

#### Memory candidate

如果需要写文件，用一个很轻的 Markdown：

```markdown
---
name: xiaoba-default-report-language
status: candidate
---

用户偏好：XiaoBa / Arena 报告默认使用中文。
```

如果只是普通“记住”请求，优先走现有 remember/memory 机制，不要为了 self-evolution 另造系统。

#### Tool inside skill

如果 skill 需要 Python tool：

- 放在 `skills/<skill-name>/<tool_name>.py`。
- 脚本必须能独立运行。
- tool 的存在要写进 `SKILL.md`，不要单独注册成一个新长期能力。

最小模板：

```python
#!/usr/bin/env python3
"""<工具描述>"""
import json

def main():
    result = {"status": "success", "message": "完成"}
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
```

### Step 3：向用户确认

展示最小方案：

- 类型：memory / skill / role / tool
- 名称
- 产出文件
- `status: candidate`
- 为什么需要沉淀

用户确认后再写文件。

### Step 4：执行创建

- 创建 Skill：写入 `skills/<name>/SKILL.md`。
- 创建 Role：写入 `roles/<name>/role.json` 和 prompt；只有用户明确要求或项目规则要求时再补 SPEC/PLAN。
- 创建 Memory candidate：写入 `memory/candidates/<name>.md`，或输出待确认片段。
- 创建 Tool：写入对应 skill 目录。

### Step 5：验证与交付

创建完成后：

1. 确认文件在正确位置。
2. 如果生成了 tool，至少跑一次语法/最小执行验证。
3. 报告新产物仍是 `candidate`，可显式使用，但待 Arena/人工评测后再改为 `active`。

## 注意事项

- 一次 self-evolution 默认只沉淀一个主要产物。
- 不要把一次任务里的所有经验都变成能力；只沉淀明显会复用的东西。
- 不要因为生成了 candidate 就修改默认加载策略。
- 不要把 Arena scorecard、trace 路径、review 结论塞进产物头部；这些证据归 Arena 管。
- 如果用户只需要临时自动化，不要升级成 skill / role。
