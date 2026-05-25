# XiaoBa Benchmarks

这个目录保存可以长期复用的 benchmark catalog。每个 benchmark 用一个主题化文件夹承载，避免真实 trace、场景、分数和报告混在一起。

## Folder Convention

推荐命名：

```text
<surface-or-domain>-<theme>-<date-or-range>
```

示例：

```text
BioBench/
```

每个 benchmark 目录可以包含两类内容：可提交的设计文档，以及默认只在本地生成的 trace-derived artifacts。

可提交文档：

- `README.md`：介绍来源、主题、baseline 和适用范围。
- `SPEC.md`：领域或主题特化规范。
- `EVALUATION.md`：评测口径、verifier、scorecard 和 release gate。

本地生成 artifacts：

- `benchmark.json`：机器可读 manifest。
- `episodes.jsonl`：一行一个抽取后的 episode，完整保留任务级 metadata。
- `cases.jsonl`：一行一个 case，供后续 replay/eval runner 使用。
- `dataset-card.md`：episode 规模、分布、成功率、分类统计。
- `summary.md`：自动生成的统计摘要。

除非经过专项审查，本地生成 artifacts 不提交到公开仓库。

通用工程规范见 [`SPEC.md`](SPEC.md)。工程推进计划见 [`PLAN.md`](PLAN.md)。具体 benchmark 可以在自己的目录下补充领域特化 `SPEC.md` / `EVALUATION.md`，但应复用根目录定义的 `Session -> Episode -> Turn -> Tool Call` 层级和 case metadata 约定。

## Privacy Rule

这里不要放原始 trace 包、原始聊天文本、真实用户 id、credentials、私网地址或本机绝对路径。真实 trace 只作为本地输入源；trace-derived artifacts 即使已规范化和脱敏，也要默认留在本地输出目录，只有通过隐私审查后才进入仓库。

默认命令会匿名化 trace 文件路径，也不会写入用户/助手原文：

```bash
npm run benchmark:legacy-trace -- /path/to/sessions.zip --out benchmarks/<topic-folder>
```

推荐先输出到 repo 外的临时目录，例如：

```bash
npm run benchmark:legacy-trace -- /path/to/sessions.zip --out /tmp/xiaoba-benchmark-review
```
