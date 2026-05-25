# XiaoBa-CLI 提问复盘

## 1. 什么是指数退避

现场短答：

指数退避是失败重试时的一种等待策略：第一次失败等一个较短时间，后面每失败一次等待时间按指数增长，例如 1s、2s、4s、8s，同时通常会设置最大等待上限，并加一点随机抖动，避免大量客户端同时重试把服务打爆。

可以继续展开：

- 适用场景：网络抖动、限流、临时 5xx、WebSocket 重连、长轮询失败。
- 关键点：只重试可恢复错误；尊重服务端 `Retry-After`；设置最大重试次数和最大延迟；加 jitter 防止惊群。
- XiaoBa-CLI 里的例子：
  - `src/utils/ai-service.ts`：模型 API 调用失败时优先读 `Retry-After`，否则用 `BASE_DELAY_MS * 2^attempt + jitter`。
  - `src/weixin/index.ts`：长轮询非超时错误后从 1s 开始退避，最高 30s。
  - `src/catscompany/client.ts`：WebSocket 断开后按指数退避重连，最高 30s。

面试时可以补一句工程判断：

我不会把指数退避当成“所有失败都重试”的万能逻辑，而是先区分失败类型。比如 429、网络超时适合重试，认证失败、参数错误、权限错误通常应该快速失败并给出可观测日志。

## 2. WebSocket 有几种协议形式

现场短答：

最常见的协议形式是两种 URL scheme：`ws://` 和 `wss://`。`ws://` 是明文 WebSocket，`wss://` 是基于 TLS 的安全 WebSocket，类似 HTTP 里的 `http://` 和 `https://`。

如果面试官继续追问，可以分层回答：

- 传输安全层：`ws://` 明文，`wss://` 加密。
- 握手层：常见是 HTTP/1.1 `Upgrade: websocket`；新标准里也可以基于 HTTP/2 extended CONNECT，但业务开发中通常由 SDK 或网关屏蔽。
- 数据帧层：WebSocket 支持 text frame、binary frame、ping/pong、close frame。
- 应用协议层：可以通过 `Sec-WebSocket-Protocol` 协商子协议；业务里也常用 JSON message envelope，例如 `ctrl`、`data`、`pub`、`sub` 这类消息。

结合 XiaoBa-CLI：

- 飞书入口是 SDK 管理的 WebSocket 长连接。
- CatsCompany 入口是自维护 WebSocket client：连接时带 `X-API-Key`，有握手、消息分发、ack、ping/pong 心跳、断线重连、重新订阅 topic。
- 微信入口当前不是 WebSocket，而是长轮询，所以它的稳定性重点是 long poll timeout、游标状态和退避重试。

## 3. 如何体现工程思维

不要只说“我会写功能”，要说自己怎么把不确定的系统做稳。可以按这个结构回答：

1. 先拆边界：入口层、runtime 层、工具层、模型 provider、日志与 memory、评测 harness 分开设计。
2. 先想失败：网络会断、API 会限流、工具会超时、上下文会爆、日志可能泄密、用户会从多个 IM 入口进来。
3. 让系统可恢复：重试、退避、failover、WebSocket 重连、session restore、context compression、memory finalization。
4. 让系统可观测：记录 session JSONL、runtime log、tool trace、token usage、benchmark summary、scorecard/report。
5. 让系统可回归：把线上/历史 trace 变成 benchmark case，而不是只靠手动感觉。
6. 让实现可演进：roles、skills、tools、subagents、reviewer eval 都是分层能力，后续能替换或扩展。

可以说成一段：

我的工程思维不是只把 demo 跑通，而是围绕真实运行环境设计闭环。XiaoBa-CLI 面向 IM-native agent，问题不是一次对话能不能回答，而是多入口、多角色、长会话、工具调用、失败恢复和结果交付能不能长期稳定。因此我会把系统拆成 runtime、adapter、tools、memory、eval 几层，并且给每层都设计失败兜底和可观测证据。

## 4. XiaoBa-CLI 如何做评测

现场短答：

我不是简单收集用户 trace 然后凭感觉发版，而是把 trace 当成评测数据源。整体评测分四层：底层用单元和集成测试保证 runtime contract；中间用历史 trace benchmark 把真实问题转成可回归 case；上层用真实 CLI/IM 入口做端到端黑盒评测；最后用线上观测和 case replay 把失败沉淀回评测集。这样每次修复都要回答三个问题：问题能不能复现、修完能不能机器判定、以后会不会回归。

更自然的面试说法：

XiaoBa-CLI 是一个 agent runtime，不能只用传统“函数输入输出”测试。它有模型调用、工具调用、长会话、IM 入口、文件交付和失败恢复，所以我的评测体系分成 offline regression、runtime harness、true E2E 和 production feedback loop。trace 只是入口，真正的关键是把 trace case 化、断言化、可重放化。

### A. 基础正确性

- `npm test` 跑单元和集成测试。
- 覆盖 provider block 转换、tool manager、role resolver、context compressor、memory finalizer、session store、rate limit retry、reviewer 工具等关键模块。
- 价值：保证底层 contract 不坏。

这层回答的是：代码改了以后，核心模块的契约有没有被破坏。

### B. Runtime Harness

- 看长会话是否能压缩上下文并保留关键事实。
- 看 tool call / tool result 是否保持合法配对。
- 看 rate limit、网络错误、工具失败后能否恢复。
- 看 IM 可见输出是否被保留，避免重复发送或前后矛盾。

这层回答的是：agent loop 在真实复杂状态下还能不能稳定跑，而不是单个函数对不对。

### C. Trace Benchmark

- 使用 `npm run benchmark:legacy-trace -- /path/to/sessions.zip`。
- 输入旧版 session JSONL 或 zip，输出 `benchmark.json`、`cases.jsonl`、`summary.md`。
- 分数不是模型回答质量，而是 trace ingestion quality：JSONL 解析覆盖率、工具成功率、慢工具/超时、context pressure、日志敏感信息卫生。
- 自动提炼高价值回归 case，例如 rate limit recovery、network failure recovery、context pressure、artifact delivery、runtime restore、platform command mismatch。

这层回答的是：真实用户遇到的问题能不能变成稳定回归资产。

### D. Case Replay / Evaluator

这一层是最能体现体系化的部分。理想 case 不是一段聊天记录，而是一份结构化样本：

- source：来自哪个 session、runtime log 或用户反馈。
- fixture：用户输入、必要上下文、文件、工具响应或 mock 模型输出。
- replay mode：`mock`、`recorded`、`live` 三档。
- assertions：必须调用或不能调用的工具、必须生成的 artifact、不能出现的错误、必须进入的状态、返回结构化内容等。
- result：`pass`、`fail`、`inconclusive`，并保存 replay result、evaluation result、trace 和 report。

第一版 evaluator 应优先用规则判断，不把 LLM judge 当唯一裁判。能确定性判断的先规则化，例如 artifact 是否生成、工具错误是否消失、日志是否脱敏、状态是否闭环。LLM judge 只补充语义质量。

### E. Reviewer 真实端到端评测

- 用 `reviewer_xiaoba_cli_e2e` 从真实 CLI interactive session 启动被测角色。
- 默认测 `engineer-cat`，像真实用户一样发消息。
- 记录 normalized transcript、终端 capture、clean log、manifest、scorecard、report。
- 再跑独立 verifier command，例如 `node dist/index.js --help` 或更具体的业务检查。
- 结果分为 `pass`、`partial`、`fail`、`blocked`，避免只给主观描述。

这层回答的是：从用户入口看，系统是不是真的能交付，而不是内部模块看起来都对。

### F. 评价指标

- 任务完成度：是否理解需求并交付结果。
- 工具成功率：工具调用成功率、失败类型、重试后恢复率。
- 恢复能力：rate limit、网络错误、WebSocket 断线、工具超时后是否能恢复。
- 上下文治理：长会话是否保留最后用户意图、已发送文件、用户已见输出和关键事实。
- 可观测性：有没有 trace、日志、scorecard、产物路径。
- 安全性：是否避免泄露 token、home path、私网地址等敏感信息。
- 用户体验：是否及时汇报进度，是否避免重复解释，交付是否可用。
- 可回归性：这次失败能否沉淀成 case，下次自动验证。

### G. 怎么回答“现在是不是还不健全”

可以坦诚但有框架地说：

当前已经落地的是三块：基础单测/集成测试、legacy trace benchmark、Reviewer 真实 CLI E2E。现在还在补齐的是更标准的 Case Store、Replay Runner 和 Rule Evaluator。也就是说，我现在不是只有“收集 trace”，而是已经把 trace ingestion、case manifest、scorecard/report 这些底座做起来了，下一步是把每条高价值 trace 变成可 replay、可断言、可进入 CI 或 nightly 的评测样本。

可以用一句话收束：

我对 XiaoBa-CLI 的评测目标不是“证明某次模型回答好”，而是证明这个 agent runtime 在真实入口、真实工具、真实长会话和真实失败条件下，能稳定交付、能留下证据、能把失败沉淀成下一轮可自动回归的评测资产。
