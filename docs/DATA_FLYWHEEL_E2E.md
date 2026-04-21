# XiaoBa 数据飞轮闭环测试说明

## 1. 闭环目标

这套数据飞轮的目标是把真实运行日志变成可追踪、可修复、可验收的闭环：

1. `XiaoBa-CLI` 产生日志或 session JSONL
2. 日志进入 `XiaoBa-AutoDev` 的 `log archive`
3. `Inspector` 审查日志，生成 assessment，并在需要时创建 case
4. `Engineer` 拉取 `fixing` case，产出实现文档 / patch / 结构化输出
5. `Reviewer` 拉取 `reviewing` case，产出 review / metrics / writeback 结果
6. case 进入 `closed` 或 `reopened`

简化视图：

```text
session log
  -> AutoDev /logs
  -> Inspector
  -> AutoDev /cases (fixing)
  -> Engineer
  -> AutoDev /cases (reviewing)
  -> Reviewer
  -> closed / reopened
```

## 2. 仓库分工

- `XiaoBa-AutoDev`
  - case 平台
  - log archive
  - artifact / event / state 持久化
- `XiaoBa-CLI`
  - 产生日志
  - `ingest_log` / `LogIngestScheduler`
  - `inspector-cat` / `engineer-cat` / `reviewer-cat` worker

## 3. 测试前提

先确认两个仓库都能正常启动：

- `XiaoBa-AutoDev` 需要可用的 MySQL 和 MinIO 配置
- `XiaoBa-CLI` 需要正确的 `.env`
- `XiaoBa-CLI/.env.example` 里至少要配这些变量：

```env
AUTODEV_SERVER_URL=http://127.0.0.1:8090
AUTODEV_API_KEY=
LOG_INGEST_AUTO_ENABLED=true
LOG_INGEST_STABLE_MINUTES=1
LOG_INGEST_AUTO_MAX_FILES=3
AUTODEV_ENGINEER_POLL_INTERVAL_MS=300000
AUTODEV_REVIEWER_POLL_INTERVAL_MS=300000
AUTODEV_REVIEWER_WRITEBACK_ENABLED=true
```

## 4. 推荐测试路径

推荐分成两条：

1. `人工闭环`
   - 最稳
   - 便于逐步观察 `/logs` 和 `/cases`
2. `自动回流`
   - 测 `LogIngestScheduler`
   - 更接近日常运行

---

## 5. 人工闭环测试

这条链路最适合先跑通一次全流程。

### 5.1 启动 AutoDev

在 `XiaoBa-AutoDev` 目录执行：

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-AutoDev
python -m uvicorn app.main:app --host 0.0.0.0 --port 8090 --app-dir .
```

启动后确认：

```powershell
Invoke-RestMethod http://127.0.0.1:8090/health
```

预期能看到 `status=ok`。

### 5.2 准备一条测试日志

在 `XiaoBa-CLI` 目录执行：

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-CLI
$logDir = 'logs\sessions\feishu\2099-01-01'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
@'
{"entry_type":"turn","turn":1,"timestamp":"2099-01-01T08:00:00.000Z","session_id":"user:e2e-demo","session_type":"feishu","user":{"text":"请排查 runtime timeout"},"assistant":{"text":"开始排查","tool_calls":[]},"tokens":{"prompt":12,"completion":8}}
{"entry_type":"runtime","timestamp":"2099-01-01T08:00:05.000Z","session_id":"user:e2e-demo","session_type":"feishu","level":"ERROR","message":"runtime timeout while calling tool retry path"}
'@ | Set-Content -Encoding UTF8 "$logDir\feishu_user_e2e_demo.jsonl"
```

这里故意用了 `2099-01-01`，这样 `ingest_log` 只会抓这一天的样例，不会把你现有日志一起上传。

### 5.3 启动 CLI 并手动上传日志

同样在 `XiaoBa-CLI` 目录执行：

```powershell
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
$env:LOG_INGEST_AUTO_ENABLED='true'
$env:LOG_INGEST_STABLE_MINUTES='1'
$env:LOG_INGEST_AUTO_MAX_FILES='3'
npm run dev -- chat -i
```

进入对话后输入：

```text
请执行 ingest_log，把 2099-01-01 这一天 feishu 渠道的 session 日志上传到 AutoDev。
```

预期结果：

- CLI 回复“已上传 1 个日志文件到 AutoDev log 存档”
- `http://127.0.0.1:8090/logs` 能看到这条新日志

### 5.4 启动 Inspector 闭环

新开一个终端，在 `XiaoBa-CLI` 目录执行：

```powershell
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
npm run dev -- chat -r inspector-cat -i
```

进入对话后输入：

```text
请立即审查 AutoDev 当前待处理的日志，limit=1。
```

更强提示词也可以：

```text
请调用 inspect_pending_logs，limit=1，并把审查结果回写到 AutoDev。
```

预期结果：

- `/logs` 详情页里会出现 inspector card / event
- `/cases` 会新增一个 case
- case 状态通常会进入 `fixing`

### 5.5 启动 Engineer 闭环

再开一个终端，在 `XiaoBa-CLI` 目录执行：

```powershell
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
npm run dev -- chat -r engineer-cat -i
```

说明：

- `engineer-cat` 启动后会立即跑一次 `AutoDevEngineerWorker.runOnce()`
- 然后按轮询间隔继续跑

预期结果：

- case 从 `fixing` 进入 `reviewing`
- case 详情页里出现：
  - implementation note
  - implementation summary
  - patch

### 5.6 启动 Reviewer 闭环

再开一个终端，在 `XiaoBa-CLI` 目录执行：

```powershell
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
$env:AUTODEV_REVIEWER_WRITEBACK_ENABLED='true'
npm run dev -- chat -r reviewer-cat -i
```

说明：

- `reviewer-cat` 启动后也会立即跑一次 `AutoDevReviewerWorker.runOnce()`

预期结果：

- case 从 `reviewing` 进入 `closed` 或 `reopened`
- case 详情页里出现：
  - review
  - writeback plan
  - writeback result
  - case metrics
  - closure note

如果是样例 case，正常预期是 `closed`。

---

## 6. 自动回流测试

这条路径主要验证 `LogIngestScheduler`。

### 6.1 先准备日志

还是先在 `XiaoBa-CLI` 写入一条测试日志：

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-CLI
$logDir = 'logs\sessions\feishu\2099-01-02'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
@'
{"entry_type":"turn","turn":1,"timestamp":"2099-01-02T08:00:00.000Z","session_id":"user:e2e-auto","session_type":"feishu","user":{"text":"自动回流测试"},"assistant":{"text":"收到","tool_calls":[]},"tokens":{"prompt":10,"completion":6}}
'@ | Set-Content -Encoding UTF8 "$logDir\feishu_user_e2e_auto.jsonl"
```

### 6.2 启动普通 runtime

```powershell
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
$env:LOG_INGEST_AUTO_ENABLED='true'
$env:LOG_INGEST_STABLE_MINUTES='1'
$env:LOG_INGEST_AUTO_MAX_FILES='3'
npm run dev -- chat -i
```

说明：

- `chat` 命令启动时会执行 `startRuntimeCommandSupport()`
- 如果当前不是 `inspector-cat`，且配置了 `AUTODEV_SERVER_URL`，会启动 `LogIngestScheduler`
- scheduler 启动时会先跑一次 `startup` 补传

预期结果：

- CLI 日志中出现 `LogIngest` 相关输出
- AutoDev `/logs` 出现 `user:e2e-auto`

---

## 7. 一次性最小启动命令清单

如果你只想快速复制执行，按下面顺序开 4 个终端。

### 终端 1：AutoDev

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-AutoDev
python -m uvicorn app.main:app --host 0.0.0.0 --port 8090 --app-dir .
```

### 终端 2：CLI 普通 runtime

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-CLI
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
$env:LOG_INGEST_AUTO_ENABLED='true'
$env:LOG_INGEST_STABLE_MINUTES='1'
$env:LOG_INGEST_AUTO_MAX_FILES='3'
npm run dev -- chat -i
```

然后输入：

```text
请执行 ingest_log，把 2099-01-01 这一天 feishu 渠道的 session 日志上传到 AutoDev。
```

### 终端 3：Inspector

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-CLI
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
npm run dev -- chat -r inspector-cat -i
```

然后输入：

```text
请立即审查 AutoDev 当前待处理的日志，limit=1。
```

### 终端 4：Engineer

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-CLI
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
npm run dev -- chat -r engineer-cat -i
```

### 终端 5：Reviewer

```powershell
cd E:\CatCompany-BestBotCommunity\XIAOBA-World\XiaoBa-CLI
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
$env:AUTODEV_API_KEY=''
$env:AUTODEV_REVIEWER_WRITEBACK_ENABLED='true'
npm run dev -- chat -r reviewer-cat -i
```

---

## 8. 你应该观察什么

### 在 `/logs`

- 新上传的 session log
- inspector 追加的 card
- inspector 追加的 event

### 在 `/cases`

- case 是否从 `new/inspecting` 进入 `fixing`
- 是否进入 `reviewing`
- 最终是否 `closed` 或 `reopened`

### 在 case 详情页

- assessment
- implementation summary
- patch
- review summary
- writeback result
- metrics
- closure note

---

## 9. 常见卡点

### AutoDev 启不来

优先检查：

- MySQL 连通性
- MinIO 连通性
- `XiaoBa-AutoDev/.env`

### CLI 提示 `AUTODEV_SERVER_URL 未配置`

说明当前终端没有设置环境变量，重新执行：

```powershell
$env:AUTODEV_SERVER_URL='http://127.0.0.1:8090'
```

### inspector 启动了但没有立刻处理日志

这是正常的。

原因：

- `inspector-cat` 的自动 worker 是按日程跑的
- 手工测试时要主动在对话里触发：

```text
请立即审查 AutoDev 当前待处理的日志，limit=1。
```

### engineer / reviewer 启动后没动作

优先检查 case 状态是否已经推进到：

- engineer 需要 `fixing` 或 `reopened`
- reviewer 需要 `reviewing`

---

## 10. 建议的验收口径

这套闭环手动验收通过，至少要满足：

1. 一条测试 JSONL 能进入 AutoDev `/logs`
2. Inspector 能为它生成审查结果，并创建 case
3. Engineer 能把 case 从 `fixing` 推到 `reviewing`
4. Reviewer 能把 case 推到 `closed` 或 `reopened`
5. AutoDev case 详情页能看到完整 artifacts 和 events
