---
name: webcli
description: 使用 Electron 内置 Chromium 探索任何 Web 系统（OA、CRM、ERP 等），自动发现 API 并生成 CLI 适配器（借鉴 OpenCLI 的智能分析能力）
---

# WebCLI - 把任何 Web 系统 CLI 化

> 使用 XiaoBa 内置的 Chromium，借鉴 OpenCLI 的智能分析技术

## 功能

自动探索 Web 系统（OA、CRM、ERP、内部管理系统等），发现 API，生成可用的 CLI 适配器，并管理登录状态。

## 核心特性

### ✨ 智能分析（借鉴 OpenCLI）

1. **自动滚动触发懒加载** - 模拟用户行为，触发更多 API 请求
2. **参数智能识别** - 自动识别搜索、分页、限制参数
3. **能力自动推断** - 根据 URL 模式推断功能（搜索/列表/热门等）
4. **噪音过滤** - 自动过滤静态资源和无关请求

### 🔒 安全可靠

- ✅ 完全自包含（无需安装浏览器扩展）
- ✅ 自动管理登录状态（保存/恢复 Cookies）
- ✅ 数据保存在本地，不上传
- ✅ 打包到 exe 中开箱即用

## 实现版本

### 1. explore-simple.js（推荐）

**特点：**
- 稳定可靠，适合生产使用
- 监听网络请求，分析 API 模式
- 自动识别参数类型（搜索/分页/限制）
- 生成详细的 SKILL.md 文档

**使用：**
```bash
node skills/WebCLI/explore-simple.js --url <系统地址> --name <系统名称>
```

### 2. explore-enhanced.js（实验性）

**特点：**
- 使用 Chrome DevTools Protocol 获取响应体
- 分析 JSON 结构，提取字段信息
- 自动生成 YAML 适配器
- 功能更强大但可能不稳定

**使用：**
```bash
node skills/WebCLI/explore-enhanced.js --url <系统地址> --name <系统名称>
```

### 3. explore.js（原始版本）

**特点：**
- 基础功能，简单直接
- 仅监听网络请求
- 生成基本的 SKILL.md

**使用：**
```bash
node skills/WebCLI/explore.js --url <系统地址> --name <系统名称>
```

## 工作原理

1. **使用 Electron Chromium**：XiaoBa 内置的浏览器引擎
2. **自动管理登录**：保存和恢复 Cookies，无需重复登录
3. **发现 API**：监听网络请求，自动识别 API 端点
4. **生成 Skill**：自动创建可用的 OA Skill

## 使用流程

### 步骤 1：探索 Web 系统

**用户：** "帮我把 XXX 系统 CLI 化"（OA、CRM、ERP、内部管理系统等）

**XiaoBa 会：**
1. 询问系统地址
2. 询问系统名称（用于生成 Skill）
3. 执行探索脚本

### 步骤 2：首次登录（仅一次）

如果是首次使用，会弹出浏览器窗口：
1. 在窗口中登录系统
2. 登录成功后，XiaoBa 自动保存登录状态
3. 关闭窗口

### 步骤 3：自动探索

XiaoBa 会：
1. 使用保存的登录状态访问系统
2. 监听网络请求，发现 API
3. 分析页面结构
4. 生成 Skill 文件到 `skills/<system-name>/`

### 步骤 4：使用生成的 Skill

之后就可以直接使用 CLI 命令操作该系统。

## 执行命令

### 探索 Web 系统

```bash
node skills/WebCLI/explore.js --url <系统地址> --name <系统名称>
```

**参数：**
- `--url`: Web 系统的完整 URL（如 https://crm.company.com）
- `--name`: 系统名称，用于生成 Skill（如 company-crm）

**示例：**
```bash
node skills/WebCLI/explore.js --url https://oa.company.com --name company-oa
node skills/WebCLI/explore.js --url https://crm.company.com --name company-crm
```

### 清除登录状态

如果需要重新登录，手动删除 Cookies 文件：

**Windows:**
```bash
del %APPDATA%\xiaoba\web-cookies-<系统名称>.json
```

**macOS:**
```bash
rm ~/Library/Application\ Support/xiaoba/web-cookies-<系统名称>.json
```

**Linux:**
```bash
rm ~/.config/xiaoba/web-cookies-<系统名称>.json
```

## 支持的系统类型

### Tier 1-3（约 80% 的 Web 系统）✅

- **Tier 1: 公开 API**（无需登录）
- **Tier 2: Cookie 认证**（大部分企业系统）
- **Tier 3: Token/Header 认证**

### 不支持 Tier 4（约 20%）❌

- 需要 JS 逆向的复杂签名（如某些大厂系统）

## 如何判断你的系统是否支持

1. 打开 Web 系统页面
2. 按 F12 打开开发者工具
3. 切换到 Network 标签
4. 刷新页面，查看请求
5. 如果看到 `/api/` 开头的请求，且参数中**没有** `sign`、`signature`、`w_rid` 等字段 → ✅ 支持

## 生成的 Skill 示例

探索完成后，会在 `skills/<system-name>/` 目录生成 `SKILL.md`：

```markdown
---
name: company-oa
description: 公司 OA 系统（自动生成）
---

# COMPANY-OA 系统

> 登录状态已保存，下次使用无需重新登录

## 发现的 API

- GET https://oa.company.com/api/v1/todo/list
- GET https://oa.company.com/api/v1/approval/pending
- GET https://oa.company.com/api/v1/notice/latest

## 使用方式

### 查看待办事项
**用户：** "查看我的待办"
**API：** GET /api/v1/todo/list

### 查看审批流程
**用户：** "有哪些待审批的"
**API：** GET /api/v1/approval/pending

### 查看公告
**用户：** "最新的公告"
**API：** GET /api/v1/notice/latest
```

## 登录状态管理

### 保存位置

Cookies 保存在：
```
<用户数据目录>/web-cookies-<system-name>.json
```

### 自动恢复

下次使用时，XiaoBa 会：
1. 自动加载保存的 Cookies
2. 验证登录状态
3. 如果过期，提示重新登录

### 安全性

- ✅ Cookies 保存在本地，不上传
- ✅ 仅 XiaoBa 可访问
- ✅ 可随时清除

## 故障排查

### 问题 1：提示"需要登录"

**原因：** 登录状态过期

**解决：**
1. 清除旧的登录状态（删除对应的 cookies 文件）
2. 重新执行探索命令

### 问题 2：未发现 API

**原因：** 
- 系统使用复杂签名（Tier 4）
- 页面加载时间不够

**解决：**
1. 检查系统是否属于 Tier 4（不支持）
2. 增加等待时间（修改脚本中的等待时间）

### 问题 3：生成的 Skill 不可用

**原因：** API 需要额外参数或认证

**解决：**
1. 手动编辑生成的 `SKILL.md`
2. 添加必要的参数说明
3. 或联系开发者改进探索脚本

## 优势

- ✅ **无需安装依赖**：使用 XiaoBa 内置 Chromium
- ✅ **自动管理登录**：保存 Cookies，无需重复登录
- ✅ **开箱即用**：普通用户也能使用
- ✅ **完全自包含**：不依赖外部工具
- ✅ **安全可靠**：数据保存在本地

## 限制

- ❌ 不支持需要 JS 逆向的复杂签名（Tier 4）
- ⚠️ 首次使用需要手动登录一次
- ⚠️ 登录状态可能过期，需要重新登录

## 技术细节

### 使用的技术

- **Electron BrowserWindow**：打开 Web 页面
- **Session Cookies**：保存和恢复登录状态
- **WebRequest API**：监听网络请求
- **executeJavaScript**：提取页面数据

### 不使用的技术

- ❌ OpenCLI（需要 npm 安装）
- ❌ Chrome 浏览器（需要用户安装）
- ❌ Chrome 扩展（需要手动安装）
- ❌ Playwright（增加依赖）

## 示例对话

**用户：** "帮我把公司 CRM 系统 CLI 化"

**XiaoBa：** "好的！请提供 CRM 系统的地址（如 https://crm.company.com）"

**用户：** "https://crm.mycompany.com"

**XiaoBa：** "请为这个系统起个名字（用于生成 Skill，如 mycompany-crm）"

**用户：** "mycompany-crm"

**XiaoBa：** 执行 `node skills/WebCLI/explore.js --url https://crm.mycompany.com --name mycompany-crm`

**输出：** 
```
正在探索 Web 系统...
检测到需要登录，正在打开浏览器窗口...
请在弹出的窗口中登录系统
```

**用户在弹出窗口中登录**

**XiaoBa：** "登录成功！正在探索 API..."

**输出：**
```
发现 5 个 API 端点
生成 Skill: skills/mycompany-crm/SKILL.md
探索完成！
```

**XiaoBa：** "探索完成！发现了 5 个 API。现在你可以使用 CLI 命令操作该系统了"

**用户：** "查看客户列表"

**XiaoBa：** 使用生成的 Skill，调用对应 API，返回客户列表

## 未来改进

- [ ] 支持更多系统类型的自动识别
- [ ] 智能分析 API 参数
- [ ] 自动生成 API 调用代码
- [ ] 支持 Tier 4（需要逆向）的半自动探索
- [ ] 可视化 API 结构
