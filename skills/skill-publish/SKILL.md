---
name: skill-publish
description: "发布 Skill 到官方 SkillHub：将 skill 代码托管到独立 GitHub 仓库，并向 fightheyyy/XiaoBa-SkillHub 提交 registry.json 增量 PR。"
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

SkillHub 只维护轻量索引，不托管 skill 源码。Skill 源码必须放在独立公开 GitHub 仓库，例如：

```text
https://github.com/<user>/xiaoba-skill-<name>
```

发布 PR 必须是增量 PR：

- 只修改 `registry.json`。
- 只新增一个 skill registry 条目，除非用户明确要求修正已存在条目。
- 不复制 `skills/<name>` 到 SkillHub 仓库。
- 不重排、删除、批量格式化已有 registry 条目。
- 提交前必须检查 `git diff -- registry.json`，确认 diff 只包含目标 skill 的索引增量。

## 执行流程

### Step 1：确认要发布的 skill

用户提供 skill 名称（即 `$ARGUMENTS`），你需要：

1. 检查 `skills/$ARGUMENTS/SKILL.md` 是否存在
2. 读取 `SKILL.md` 的 frontmatter，提取 `name`、`description`、`category` 等信息
3. 如果缺少 category，询问用户选择：核心、工具、效率、科研、运维、其他
4. 确认 skill 是否已经有独立公开 GitHub 仓库
5. 向用户确认发布信息

发布信息至少包含：

```json
{
  "name": "<name>",
  "description": "<desc>",
  "category": "<cat>",
  "recommended": false,
  "repo": "https://github.com/<user>/xiaoba-skill-<name>"
}
```

### Step 2：准备独立 skill 仓库

如果 skill 已经有公开仓库，使用现有 repo URL。

如果还没有公开仓库，告诉用户先在 GitHub 创建一个公开仓库，建议命名：

```text
xiaoba-skill-<name>
```

然后把本地 `skills/<name>` 的内容推送到这个独立仓库。SkillHub 的 `repo` 字段必须指向这个独立仓库，而不是 SkillHub 仓库里的子目录。

### Step 3：Fork 当前官方 SkillHub

告诉用户执行以下操作（需要 GitHub 登录）：

1. 打开 https://github.com/fightheyyy/XiaoBa-SkillHub
2. 点击右上角 **Fork** 按钮
3. Fork 到你自己的账号

完成后告知你。

### Step 4：获取用户 fork 的仓库地址

用户 fork 完成后，获取 fork 地址：

```json
{"command":"echo '请提供你的 fork 仓库地址，例如: https://github.com/YOUR_USER/XiaoBa-SkillHub'","description":"提示用户提供 fork 地址"}
```

### Step 5：Clone fork 并从 upstream main 新建发布分支

1. 获取 GitHub 用户名：
```json
{"command":"git config user.name","description":"获取 GitHub 用户名"}
```

2. 创建临时目录并 clone fork：
```json
{"command":"mkdir -p /tmp/xiaoba-publish && cd /tmp/xiaoba-publish && rm -rf XiaoBa-SkillHub && git clone https://github.com/<user>/XiaoBa-SkillHub.git","description":"Clone fork"}
```

3. 从官方 main 新建增量分支：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git remote add upstream https://github.com/fightheyyy/XiaoBa-SkillHub.git 2>/dev/null || true && git fetch upstream main && git checkout -B add-skill-<name> upstream/main","description":"从 upstream main 新建发布分支"}
```

4. 检查 fork 的内容：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && ls -la && cat registry.json","description":"查看 SkillHub registry"}
```

### Step 6：增量更新 registry.json

只允许编辑 `registry.json`。不要复制 skill 文件到 SkillHub。

用脚本安全追加 JSON 条目：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && python3 -c \"\nimport json\nfrom pathlib import Path\npath=Path('registry.json')\ndata=json.loads(path.read_text(encoding='utf-8'))\nname='<name>'\nif any(item.get('name') == name for item in data):\n    raise SystemExit(f'skill already exists in registry: {name}')\ndata.append({'name':name,'description':'<desc>','category':'<cat>','recommended':False,'repo':'https://github.com/<user>/xiaoba-skill-<name>'})\npath.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\\n',encoding='utf-8')\nprint('registry.json updated')\n\"","description":"增量更新 registry.json"}
```

如果 `git diff -- registry.json` 显示已有条目被重排、删除或批量格式化，必须恢复后重新做最小增量编辑。

### Step 7：验证 PR 只包含 registry.json 增量

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git diff -- registry.json && git status --short","description":"检查 registry 增量 diff"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && test \"$(git diff --name-only)\" = \"registry.json\" && echo 'OK: only registry.json changed'","description":"确认只修改 registry.json"}
```

### Step 8：提交并推送

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git add registry.json && git status --short","description":"只暂存 registry.json"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git commit -m 'Add skill: <name>'","description":"提交 registry 增量"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && git remote set-url origin git@github.com:<user>/XiaoBa-SkillHub.git && git push -u origin add-skill-<name>","description":"推送发布分支"}
```

### Step 9：创建 PR

告诉用户去网页上创建 PR：

1. 打开 https://github.com/<user>/XiaoBa-SkillHub
2. 点击 **Compare & pull request**
3. 确认 base repo 是 `fightheyyy/XiaoBa-SkillHub`
4. 确认 changed files 只有 `registry.json`
5. 提交 PR

或者用 gh CLI（如果安装的话）：

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-SkillHub && which gh && gh pr create --repo fightheyyy/XiaoBa-SkillHub --base main --head <user>:add-skill-<name> --title 'Add skill: <name>' --body '## New Skill: <name>\\n\\n<description>\\n\\nRegistry-only incremental PR.' || echo 'gh not installed'","description":"尝试用 gh 创建 PR"}
```

### Step 10：清理

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
- 没有删除、重排、批量格式化已有 registry 条目

## 注意事项

- **SSH Key**：确保用户本地有 SSH key 并配置到 GitHub
- **Windows**：临时目录改用 `%TEMP%`
- **如果 SSH 推送失败**：让用户在 GitHub 网页上手动上传文件
- **Skill 依赖**：提醒用户在独立 skill 仓库的 README 或 SKILL.md 里说明依赖
- **Registry-only**：SkillHub PR 不应该包含 skill 源码、README 大改或无关格式化

## 简化流程总结

```
准备独立 skill 仓库 → fork SkillHub → 从 upstream main 新建分支 → 只增量更新 registry.json → push 分支 → 创建 registry-only PR
```

这样不需要 GitHub token，也能保持 SkillHub registry PR 清晰、可审。
