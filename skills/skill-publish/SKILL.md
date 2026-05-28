---
name: skill-publish
description: "发布 Skill 到官方 SkillHub：将 skill 代码托管到独立 GitHub 仓库，并在 fightheyyy/XiaoBa-SkillHub 中只增量更新 registry.json。"
invocable: user
autoInvocable: false
argument-hint: "<skill名称>"
max-turns: 20
---

# Skill Publish

将本地已有的 skill 发布到 XiaoBa 官方 SkillHub，让所有 XiaoBa 用户都能通过 Dashboard Skill Store 安装。

## 发布模型

官方 SkillHub 仓库：

```text
https://github.com/fightheyyy/XiaoBa-SkillHub
```

Dashboard 读取：

```text
https://raw.githubusercontent.com/fightheyyy/XiaoBa-SkillHub/main/registry.json
```

SkillHub 只维护轻量索引，不托管 skill 源码。Skill 源码必须放在独立公开 GitHub 仓库。仓库名不要求固定格式，例如下面两种都可以：

```text
https://github.com/<user>/xiaoba-skill-<name>
https://github.com/<user>/<custom-skill-repo>
```

SkillHub 发布规则：

- 只修改 `registry.json`。
- 只新增一个 skill registry 条目，除非用户明确要求修正已存在条目。
- 不复制 `skills/<name>` 到 SkillHub 仓库。
- 不 fork `fightheyyy/XiaoBa-SkillHub`。
- 不重排、删除、批量格式化已有 registry 条目。
- 提交前必须检查 `git diff -- registry.json`，确认 diff 只包含目标 skill 的索引增量。
- 普通发布走官方仓分支 PR；`fightheyyy` 维护者可以按仓库 ruleset bypass 直接推 `main`。

## 执行流程

### Step 1：确认要发布的 skill

用户提供 skill 名称（即 `$ARGUMENTS`），你需要：

1. 检查 `skills/$ARGUMENTS/SKILL.md` 是否存在
2. 读取 `SKILL.md` 的 frontmatter，提取 `name`、`description`、`category` 等信息
3. 如果缺少 category，询问用户选择：核心、工具、效率、科研、运维、其他
4. 确认 skill 是否已经有独立公开 GitHub 仓库
5. 获取或确认独立 skill 仓库 URL
6. 向用户确认发布信息

发布信息至少包含：

```json
{
  "name": "<name>",
  "description": "<desc>",
  "category": "<cat>",
  "recommended": false,
  "repo": "<confirmed-skill-repo-url>"
}
```

### Step 2：准备独立 skill 仓库

如果 skill 已经有公开仓库，使用现有 repo URL。

如果还没有公开仓库，告诉用户先在 GitHub 创建一个公开仓库，建议命名：

```text
xiaoba-skill-<name>
```

然后把本地 `skills/<name>` 的内容推送到这个独立仓库。SkillHub 的 `repo` 字段必须指向这个独立仓库，而不是 SkillHub 仓库里的子目录。

### Step 3：确认 GitHub 身份和 SkillHub 权限

不要 fork SkillHub。直接使用官方仓库 `fightheyyy/XiaoBa-SkillHub`。

优先用 `gh` 获取当前 GitHub 登录名和仓库权限：

```json
{"command":"gh api user --jq '.login' && gh api repos/fightheyyy/XiaoBa-SkillHub/collaborators/$(gh api user --jq '.login')/permission --jq '.permission'","description":"确认当前 GitHub 身份和 SkillHub 权限"}
```

如果没有 `gh` 或没有 push/admin/maintain 权限，不要自动 fork。停下来告诉用户当前账号不能直接向官方 SkillHub 创建分支或推送，需要切换到有权限的 GitHub 账号，或让维护者代发。

### Step 4：Clone 官方 SkillHub 并从 origin/main 新建发布分支

1. 创建临时目录并 clone 官方仓库：
```json
{"command":"mkdir -p /tmp/xiaoba-publish && cd /tmp/xiaoba-publish && rm -rf XiaoBa-SkillHub && git clone https://github.com/fightheyyy/XiaoBa-SkillHub.git","description":"Clone 官方 SkillHub"}
```

2. 从官方 main 新建增量分支：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git fetch origin main && git checkout -B add-skill-<name> origin/main","description":"从官方 main 新建发布分支"}
```

3. 检查 registry：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && cat registry.json","description":"查看 SkillHub registry"}
```

### Step 5：增量更新 registry.json

只允许编辑 `registry.json`。不要复制 skill 文件到 SkillHub。

用脚本安全追加 JSON 条目：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && python3 -c \"\nimport json\nfrom pathlib import Path\npath=Path('registry.json')\ndata=json.loads(path.read_text(encoding='utf-8'))\nname='<name>'\nrepo='<confirmed-skill-repo-url>'\nif any(item.get('name') == name for item in data):\n    raise SystemExit(f'skill already exists in registry: {name}')\ndata.append({'name':name,'description':'<desc>','category':'<cat>','recommended':False,'repo':repo})\npath.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\\n',encoding='utf-8')\nprint('registry.json updated')\n\"","description":"增量更新 registry.json"}
```

如果 `git diff -- registry.json` 显示已有条目被重排、删除或批量格式化，必须恢复后重新做最小增量编辑。

### Step 6：验证只包含 registry.json 增量

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git diff -- registry.json && git status --short","description":"检查 registry 增量 diff"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && test \"$(git status --porcelain --untracked-files=all)\" = \" M registry.json\" && echo 'OK: only registry.json changed'","description":"确认只修改 registry.json"}
```

### Step 7：提交 registry 增量

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git add registry.json && git status --short","description":"只暂存 registry.json"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git commit -m 'Add skill: <name>'","description":"提交 registry 增量"}
```

### Step 8：发布到官方 SkillHub

默认方式：推官方仓发布分支并创建 PR。

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git push -u origin add-skill-<name>","description":"推送官方仓发布分支"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && gh pr create --repo fightheyyy/XiaoBa-SkillHub --base main --head add-skill-<name> --title 'Add skill: <name>' --body '## New Skill: <name>\\n\\n<description>\\n\\nRegistry-only incremental PR.'","description":"创建官方仓 registry-only PR"}
```

维护者快捷方式：如果当前账号是 `fightheyyy`，且用户明确要求直接发布，可以 fast-forward 到 `main` 并直接推送：

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git checkout main && git merge --ff-only add-skill-<name> && git push origin main","description":"fightheyyy 维护者直接推送 main"}
```

### Step 9：清理

```json
{"command":"rm -rf /tmp/xiaoba-publish","description":"清理临时目录"}
```

## PR 验收标准

- PR base：`fightheyyy/XiaoBa-SkillHub:main`
- PR changed files：只有 `registry.json`
- `registry.json` 是合法 JSON array
- 新条目字段完整：`name`、`description`、`category`、`recommended`、`repo`
- `repo` 指向独立公开 GitHub 仓库
- 独立 skill 仓库包含 `SKILL.md`
- 没有 fork SkillHub
- 没有删除、重排、批量格式化已有 registry 条目

## 注意事项

- **GitHub 权限**：需要当前账号能向 `fightheyyy/XiaoBa-SkillHub` 创建分支或推送 main
- **Windows**：临时目录改用 `%TEMP%`
- **如果推送失败**：先检查 `gh auth status` 和仓库权限，不要自动 fork
- **Skill 依赖**：提醒用户在独立 skill 仓库的 README 或 SKILL.md 里说明依赖
- **Registry-only**：SkillHub 改动不应该包含 skill 源码、README 大改或无关格式化

## 简化流程总结

```
准备独立 skill 仓库 → clone 官方 SkillHub → 从 origin/main 新建分支 → 只增量更新 registry.json → push 官方分支并开 PR，或由 fightheyyy 直接推 main
```

这样不 fork SkillHub，也能保持 SkillHub registry 改动清晰、可审。
