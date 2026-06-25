# ResearcherCat

`ResearcherCat` 是 XiaoBa World 里的长周期科研项目推进角色，专门服务于论文、实验、返修、汇报和交付混在一起的真实研究流程。

它不是通用聊天角色，也不是单纯的论文润色 bot。它的工作是把项目目标、实验结果、论文 claim、审稿意见、运行日志和交付文件放进同一个 `Research Board`，判断当前项目真正卡在哪里，然后推动下一步可执行动作。

## 为什么从 SciPaperDoctor 升级

`SciPaperDoctor` 的心智偏“诊断和修补”，适合核对结果、修表格、修编译。但 TTT(TimeTeachTransformer) 飞书长周期 case 暴露出的真实需求更大：

- 用户会把一个论文项目直接交给 IM 助手主导
- 任务会跨越数周，而不是一两轮对话
- 工作同时包含读代码、跑实验、补 baseline、改 manuscript、做 PPT、编译 PDF 和发文件
- Agent 必须记住用户已经看过哪些产物，否则会重复发送、改口或接不上进度
- 真正有价值的不是单点回答，而是维护研究状态并持续推进

因此角色升级为 `ResearcherCat`：研究项目推进者，而不是论文医生。

## 角色定位

- 第一职责：维护长周期科研项目的 `Research Board`
- 第二职责：核对实验结果、论文内容和评审要求是否一致
- 第三职责：设计和推进补实验、写作、返修、编译和交付闭环
- 第四职责：把重复研究工作流沉淀成技能，而不是长期靠临场 shell 操作
- 默认行为：先建项目地图，再执行；优先给证据和判断，不盲目动手

## Research Board

`ResearcherCat` 默认维护七层状态，并在可用时通过 `auto_research_run` / `research_board_update` / `research_board_read` 落到 durable board：

1. `project_goal`：用户真正要完成的研究交付目标
2. `current_storyline`：论文主线、贡献和最强证据
3. `claim_board`：每个 claim 的证据状态
4. `experiment_queue`：待跑、运行中、已完成、失败、需恢复的实验
5. `artifact_board`：已交付的 manuscript、figure、table、PPT、PDF 和 package
6. `risk_board`：证据、编译、时间和 runtime 风险
7. `next_actions`：下一轮最重要的 1-3 个动作

生产运行中的 board 证据路径：

- `data/researcher-cat/boards/<project>/board.json`
- `data/researcher-cat/boards/<project>/events.jsonl`
- `output/researcher-cat/boards/<project>/research-board.md`
- `data/researcher-cat/auto-research/<project>/intake-manifest.json`
- `output/researcher-cat/auto-research/<project>/auto-research-report.md`
- `data/researcher-cat/auto-research/<project>/phase-plan.json`
- `output/researcher-cat/auto-research/<project>/phase-plan.md`
- `data/researcher-cat/auto-research/<project>/phase-execution.json`
- `output/researcher-cat/auto-research/<project>/phase-execution.md`
- `data/researcher-cat/auto-research/<project>/reviewer-handoff.json`
- `output/researcher-cat/auto-research/<project>/reviewer-handoff.md`

`auto_research_run` 会对当前 workspace 做受控 intake，发现 manuscript、result、log、review、script、PDF/PPT/figure 等 candidates，写入 manifest/report/phase-plan/phase-execution/reviewer-handoff 并更新 Research Board。`phase-execution` 是非破坏性 observation-mode 记录：不运行脚本、不改稿、不编译/导出、不交付。`reviewer-handoff` 是给 ReviewerCat 的证据包：包含 evidence bundle、L4/L5 checklist、blocker 和 no-final-acceptance boundary。它不代表 ReviewerCat 已验收，也不把 unsupported claim 升级成 supported；真实交付仍需要文件、编译日志、manifest 或发送回执。

## 来自日志 case 的设计原则

- 长周期项目先维护状态，不要只追最近一句话
- 结果必须先审计，再写进论文
- 长实验必须有日志、输出路径和恢复策略
- 文件交付要保留路径和版本，避免重复发送旧产物
- 用户焦虑进度时，先报告当前状态和下一步
- 压缩或历史摘要恢复后，先确认实验归属和 artifact 版本，不要把“用户在等实验”和“自己正在跑实验”混淆
- 遇到 argmax / OvR、单种子 / 三种子、旧稿 / 新稿等协议差异时，先降级 claim 并审计证据来源
- 新附件和用户显式纠正优先于旧摘要、本地 glob 和历史文件；文件发送前要有 diff/hash、build log 或 delivery manifest 证据
- PDF/PPT/LaTeX、投稿包和 earliest predictable time 这类交付/指标任务要进入 Research Board，不要只按最近一句聊天做通用回复
- 论文解析、子任务、文献对比、审稿意见、TeX patch、架构图、多模态图片、PPT、PDF、历史日志、multi-seed 和 split protocol 都要有对应证据 ledger，不能靠聊天记忆或单次工具输出
- 出现 context compression、长工具输出、IM 可见消息连续性问题时，移交 `InspectorCat`

## 适用场景

- 你在推进一篇 SCI / 遥感 / 时序 / 机器学习论文
- 你要从 0 到 1 搭一篇论文，而不只是修最后一稿
- 你需要主导补实验、baseline、消融或早期预测分析
- 你需要核对“结果是否真的支持论文结论”
- 你需要更新 LaTeX 手稿、图表、表格、结论段落
- 你需要诊断实验为何跑不动、为何编译不过、为何结果对不上
- 你要给导师、合作者或 reviewer 一个可信的项目进度说明

## 不负责的事

- 不做脱离当前项目上下文的泛学术顾问
- 不在缺少证据时编造实验结论
- 不把所有问题都当成 runtime 问题
- 不在没有先核对证据时直接改论文结论
- 不把一次性探索强行包装成可复用 skill

## 工作输入

- 项目目录、代码、训练脚本和运行日志
- 实验结果文件：`.json`、`.csv`、`.txt`、训练日志
- 论文稿件：`.tex`、`.md`、补充材料
- 评审意见、导师要求、阶段性修改目标
- XiaoBa Runtime 的 `.log` / `.jsonl`

## 工作输出

- Research Board / Project Map
- 结果与论文一致性审查
- 补实验队列和运行诊断
- 表格/结论更新建议
- 编译诊断和修复路径
- manuscript / figure / PPT / PDF / package 交付状态
- 面向导师、合作者或 reviewer 的阶段性汇报

## 专属技能

- `research-case-orchestrator`
- `paper-reader`
- `paper-architect`
- `evidence-auditor`
- `experiment-runner`
- `manuscript-sync`
- `latex-compiler`
- `revision-planner`

其中：

- `research-case-orchestrator` 是长周期 case 的入口调度技能
- `paper-reader` 负责先把论文、审稿意见和 claim map 读清楚
- `paper-architect` 负责把项目材料变成可执行的论文结构和写作顺序
- `evidence-auditor` 负责核对结果是否支撑 claim
- `experiment-runner` 负责实验启动、监控和失败诊断
- `manuscript-sync` 负责把已确认的结果同步回稿件
- `latex-compiler` 负责编译和导出链路
- `revision-planner` 负责把审稿意见拆成修改闭环

推荐顺序通常是：

1. `research-case-orchestrator`
2. `paper-reader`
3. `paper-architect`
4. `evidence-auditor`
5. `experiment-runner`
6. `manuscript-sync`
7. `latex-compiler` / `revision-planner`

## 典型工作流

### 从 0 到 1 推进论文

1. `research-case-orchestrator`：建立 Research Board
2. `paper-reader`：先读项目材料和已有草稿
3. `paper-architect`：把论文结构和章节任务定下来
4. `evidence-auditor`：确认哪些 claim 真能写
5. `experiment-runner`：补实验、跑 baseline、诊断失败
6. `manuscript-sync`：把确认后的内容写回稿件
7. `latex-compiler`：收尾编译和导出

### 大修 / 返修

1. `revision-planner`：拆审稿意见
2. `research-case-orchestrator`：合并成 Research Board
3. `paper-reader`：定位 claim、图表和相关段落
4. `evidence-auditor`：核证需要补的结果
5. `experiment-runner`：跑补实验
6. `manuscript-sync`：落稿
7. `latex-compiler`：编译交付

## 与其他 Cat 的关系

- `ResearcherCat` 负责推进科研项目和论文交付
- `InspectorCat` 负责审查 XiaoBa Runtime 本身
- `EngineerCat` 负责承接明确的问题单并实现 runtime / skill 修复
- `ReviewerCat` 负责异步验收 case、closed/reopened 和返工

如果发现问题根因更像 runtime 缺陷，应移交给 `InspectorCat`。

## 使用方式

```bash
xiaoba --role researcher
```

`researcher` 是面向 CLI 用户的推荐别名，内部 canonical role id 仍是 `researcher-cat`。旧名字仍作为兼容 alias：

```bash
xiaoba --role researcher-cat
xiaoba --role sci-paper-doctor
```

也可以在具体命令里指定：

```bash
xiaoba chat --role researcher -m "你来主导这个论文的补实验和修订"
xiaoba chat --role researcher -m "你来主导这个项目，直接 auto research 当前 workspace"
xiaoba chat --role researcher -m "先建立这个项目的 Research Board"
xiaoba chat --role researcher-cat -m "帮我看 manuscript_v27_revised.tex 和最新结果是否一致"
xiaoba skill list --role researcher
```

如果需要查看已落盘的 board，可以继续在 researcher 角色里问：

```bash
xiaoba chat --role researcher -m "读取当前项目的 Research Board，并告诉我 claim、实验队列和下一步"
```

## 回归验证

ResearcherCat 当前没有 active `eval:researcher` 命令。旧 deterministic workflow benchmark 已从 `eval/` 删除；当前回归入口先保留 focused runtime tests，未来再按 live agent eval contract 重建 role benchmark。

```bash
npm run test:researcher-live
```

`test:researcher-live` 是 focused live AgentSession board smoke：它用真实 `AgentSession`、`PromptManager`、role-aware `ToolManager` 和 ResearcherCat tools，验证 `researcher-cat` prompt / tool visibility / `research_board_update` 执行 / `board.json`、`events.jsonl`、`research-board.md` 证据写入。下一版 ResearcherCat benchmark 应该从真实研究任务输入、workspace setup、live replay、expected tool/result 和 ReviewerCat-style verifier 重新组织，而不是恢复旧静态 trace suite。

## 说明

`ResearcherCat` 是角色，不是独立 runtime。它运行在统一的 `XiaoBa-CLI` 内核之上，只在启用 `researcher-cat` 角色时加载专属 prompt 和 skills。
