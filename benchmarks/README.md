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

每个 benchmark 目录至少包含：

- `README.md`：介绍来源、主题、baseline 和适用范围。
- `benchmark.json`：机器可读 manifest。
- `cases.jsonl`：一行一个 case，供后续 replay/eval runner 使用。
- `summary.md`：自动生成的统计摘要。

## Privacy Rule

这里不要放原始 trace 包、原始聊天文本、真实用户 id、credentials、私网地址或本机绝对路径。真实 trace 只作为本地输入源；进 catalog 的内容必须是规范化、脱敏后的 benchmark artifact。

默认命令会匿名化 trace 文件路径，也不会写入用户/助手原文：

```bash
npm run benchmark:legacy-trace -- /path/to/sessions.zip --out benchmarks/<topic-folder>
```
