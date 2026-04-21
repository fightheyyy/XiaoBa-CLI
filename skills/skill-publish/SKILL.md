---
name: skill-publish
description: "发布 Skill 到官方 Skill Hub：通过 fork 方式提交 PR，无需 GitHub token。让所有 XiaoBa 用户都能安装。"
invocable: user
autoInvocable: false
argument-hint: "<skill名称>"
max-turns: 20
---

# Skill Publish (简化版)

将本地已有的 skill 发布到 XiaoBa 官方 Skill Hub。

## 核心变化

**旧流程（需要 token）：**
1. 创建 `xiaoba-skill-<name>` 仓库 ❌
2. Fork Hub
3. 更新 registry.json
4. 创建 PR

**新流程（不需要 token）：**
1. 用户手动 fork Hub（网页操作）
2. 本地添加 skill 文件到 fork
3. 提交 PR

## 执行流程

### Step 1：确认要发布的 skill

用户提供 skill 名称（即 `$ARGUMENTS`），你需要：

1. 检查 `skills/$ARGUMENTS/SKILL.md` 是否存在
2. 读取 SKILL.md 的 frontmatter，提取 name、description、category 等信息
3. 如果缺少 category，询问用户选择：核心、工具、效率、科研、运维、其他
4. 向用户确认发布信息

### Step 2：告知用户手动 Fork Hub

告诉用户执行以下操作（需要 GitHub 登录）：

1. 打开 https://github.com/buildsense-ai/XiaoBa-Skill-Hub
2. 点击右上角 **Fork** 按钮
3. Fork 到你自己的账号

完成后告知你。

### Step 3：获取用户 fork 的仓库地址

用户 fork 完成后，获取 fork 地址：

```json
{"command":"echo '请提供你的 fork 仓库地址，例如: https://github.com/YOUR_USER/XiaoBa-Skill-Hub'","description":"提示用户提供 fork 地址"}
```

### Step 4：Clone fork 并添加 skill

1. 获取 GitHub 用户名：
```json
{"command":"git config user.name","description":"获取 GitHub 用户名"}
```

2. 创建临时目录并 clone fork：
```json
{"command":"mkdir -p /tmp/xiaoba-publish && cd /tmp/xiaoba-publish && rm -rf XiaoBa-Skill-Hub && git clone https://github.com/<user>/XiaoBa-Skill-Hub.git","description":"Clone fork"}
```

3. 检查 fork 的内容：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && ls -la && cat registry.json | head -50","description":"查看 fork 内容"}
```

### Step 5：复制 skill 文件到 fork

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && mkdir -p skills/<name> && cp -r /path/to/skills/<name>/* skills/<name>/","description":"复制 skill 文件"}
```

### Step 6：更新 registry.json

用 Python 脚本安全更新 JSON：
```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && python3 -c \"\nimport json\nd=json.load(open('registry.json'))\nnew_entry={'name':'<name>','description':'<desc>','category':'<cat>','recommended':False,'repo':'https://github.com/<user>/XiaoBa-Skill-Hub/tree/main/skills/<name>'}\nd.append(new_entry)\njson.dump(d,open('registry.json','w'),indent=2,ensure_ascii=False)\nprint('registry.json updated')\n\"","description":"更新 registry.json"}
```

### Step 7：提交并推送

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && git add skills/<name> registry.json && git status","description":"添加文件并检查状态"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && git commit -m 'Add skill: <name>' && git branch -M main","description":"提交更改"}
```

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && git remote -v","description":"检查远程地址"}
```

### Step 8：设置远程推送地址

由于不需要 token，用 SSH 方式推送（依赖用户本地的 SSH key）：

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && git remote set-url origin git@github.com:<user>/XiaoBa-Skill-Hub.git && git remote -v","description":"设置为 SSH URL"}
```

### Step 9：推送到 fork

```json
{"command":"cd /tmp/xiaoba-publish/XiaoBa-Skill-Hub && git push origin main","description":"推送更改"}
```

### Step 10：创建 PR

告诉用户去网页上创建 PR：
1. 打开 https://github.com/YOUR_USER/XiaoBa-Skill-Hub
2. 点击 **Compare & pull request**
3. 确认信息后提交

或者用 gh CLI（如果安装的话）：
```json
{"command":"which gh && gh pr create --repo buildsense-ai/XiaoBa-Skill-Hub --title 'Add skill: <name>' --body '## New Skill: <name>\n\n<description>' || echo 'gh not installed'","description":"尝试用 gh 创建 PR"}
```

### Step 11：清理

```json
{"command":"rm -rf /tmp/xiaoba-publish","description":"清理临时目录"}
```

## 注意事项

- **SSH Key**：确保用户本地有 SSH key 并配置到 GitHub
- **Windows**：临时目录改用 `%TEMP%`
- **如果 SSH 推送失败**：让用户在 GitHub 网页上手动上传文件
- **Skill 依赖**：提醒用户 skill 如果有依赖，需要在 README 里说明

## 简化流程总结

```
用户手动 fork → 用户告知 fork 地址 → 脚本 clone/fork → 添加文件 → 更新 registry → SSH push → 用户手动创建 PR
```

这样就不需要 GitHub token 了！
