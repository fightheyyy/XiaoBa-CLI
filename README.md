<div align="center">
  <img src="assets/banner.png" alt="XiaoBa Banner" width="100%">

  # 🐱 XiaoBa - 会成长的 AI Agent Runtime

  **统一 Runtime｜多角色协作｜日志驱动进化**

  [![Release](https://img.shields.io/github/v/release/buildsense-ai/XiaoBa-CLI)](https://github.com/buildsense-ai/XiaoBa-CLI/releases)
  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/buildsense-ai/XiaoBa-CLI)

  [快速开始](#-快速开始) • [为什么不一样](#-为什么不一样) • [核心能力](#-核心能力) • [开发](#-开发) • [文档](#-文档)
</div>

---

## 💡 XiaoBa 是什么？

`XiaoBa` 不是一个“接了很多模型的聊天壳子”，也不是“很多 prompt 的集合”。

它更接近一个**统一的 AI Agent Runtime**：

- 用一套 runtime 承载 `CLI`、飞书、微信、CatsCompany 等不同入口
- 用 `roles / skills / tools` 做能力分层，而不是把所有事情塞给一个 Agent
- 用真实运行日志驱动系统持续优化，而不是只靠静态 prompt
- 用本地 `Dashboard` 管理服务启动、日志查看和运行状态

如果一句话概括：

> `XiaoBa = 一个以统一 runtime 为核心、以角色分工为组织形式、以日志回流驱动持续进化的 AI Agent 系统。`

---

## ✨ 为什么不一样？

### 1. 不是“万能 Agent”，而是“统一 Runtime + 多角色分工”

复杂任务不应该长期由一个 Agent 独吞。

`XiaoBa` 的核心思路是：

- 公共能力放在 runtime
- 角色差异放在 `roles`
- 稳定工作流沉淀到 `skills`
- 确定性能力下沉为 `tools`

这样做的好处是：

- 系统边界更清楚
- 能力更容易复用
- 场景更容易扩展
- 演化成本更低

### 2. 真实日志高于漂亮概念

`XiaoBa` 不是闭门造车式 Agent。

它会沉淀：

- runtime `.log`
- session `JSONL`
- 工具调用记录
- Token 消耗与会话轨迹

这些数据不只是为了排查问题，也会进一步进入 `Inspector -> 修复 -> 验证 -> 回流` 的闭环，推动 runtime、skill 和 role 持续进化。

### 3. 不只会聊天，而是能跑系统

`XiaoBa` 关注的不是“回复像不像人”，而是：

- 能不能在真实环境里稳定工作
- 能不能接平台、接工具、接角色
- 能不能在长链路任务里持续保持上下文
- 能不能在出错后自己分析、修复、验证

---

## 🚀 核心能力

### 🧠 统一 Runtime

- 一套 runtime 承载多入口与多角色，而不是为每个角色复制一套系统
- 支持 `CLI` 使用，并接入飞书、微信、CatsCompany 等消息入口
- 提供本地 `Dashboard` 启动看板与管理面板，便于服务启停和日志查看

### 🤖 多角色与 Skill 体系

- 支持角色化扩展，让不同 Agent 拥有不同职责边界
- 支持基于 `Markdown + frontmatter` 的声明式 Skill 插件
- 支持 `Python / TypeScript` 双语言扩展能力
- 支持官方 Skill Hub 与自定义 Skill 开发

### 🔁 多 Agent 协作

- 支持子 Agent 调度与复杂任务拆解
- 支持 `A2A` 风格的任务交接、结果回传与协同扩展
- 允许不同角色围绕同一个 case 分工处理，而不是单 Agent 强撑全链路

### 🔍 日志驱动的自演化闭环

- 沉淀按 session 组织的全量 `JSONL` 日志
- 支持 `ingest_log` 将 session 日志归档到 AutoDev
- 支持围绕 `InspectorCat / EngineerCat / ReviewerCat` 构建问题发现、实现、验收与回写闭环
- 让真实用户 case 成为系统成长素材

### 🧵 长链路上下文治理

- 支持 working-memory 风格的上下文压缩
- 保留近期关键轮次，压缩旧上下文与超长工具输出
- 控制 Prompt Budget，降低长对话中的上下文膨胀风险

### 🛡️ 稳定性与工程化

- 支持多模型 `Failover`
- 支持 `429` 限流识别与自动重试
- 支持工具调用可靠性治理与错误分类
- 支持完整会话日志、Token 消耗统计与行为回放
- 基于 `Electron` 提供跨平台桌面分发

---

## 🖥️ 使用场景

`XiaoBa` 适合的不只是“聊天”：

- 个人开发与本地 AI Runtime
- 飞书 / 微信中的任务型 Agent
- 多角色协作的复杂任务处理
- 长链路知识工作与上下文管理
- 日志分析、问题定位与自动修复闭环

---

## 🚀 快速开始

### Windows 用户
1. 下载 [XiaoBa Setup](https://github.com/buildsense-ai/XiaoBa-CLI/releases/latest)
2. 双击安装
3. 启动应用，配置 API Key
4. 在 `Dashboard` 中启动所需服务

### macOS 用户
1. 下载 [XiaoBa for macOS](https://github.com/buildsense-ai/XiaoBa-CLI/releases/latest)
2. 双击安装
3. 启动应用，配置 API Key
4. 在 `Dashboard` 中启动所需服务

### 基础配置
复制 `.env.example` 为 `.env`，填入配置：
```bash
# LLM 配置
GAUZ_LLM_PROVIDER=anthropic
GAUZ_LLM_API_KEY=your_api_key

# 飞书机器人（可选）
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret

# 微信机器人（可选）
WEIXIN_TOKEN=your_token
```

---

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run electron:dev

# 构建
npm run electron:build:win
npm run electron:build:mac
npm run electron:build:linux
```

---

## 📚 文档

- [Skill 开发指南](https://github.com/buildsense-ai/XiaoBa-Skill-Hub)
- [API 文档](docs/API.md)
- [配置说明](docs/CONFIG.md)
- [XiaoBa World / Agent Loop](../AGENT_LOOP_XIAOBA_WORLD.md)
- [XiaoBa World / Worldview](../XIAOBA_WORLD_WORLDVIEW.md)

---

## 🏪 Skill Hub

访问 [XiaoBa-Skill-Hub](https://github.com/buildsense-ai/XiaoBa-Skill-Hub) 获取更多社区 Skills。

---

## 📄 License

Apache-2.0 © CatCompany

---

<div align="center">
  Made with ❤️ by CatCompany
</div>
