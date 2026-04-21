---
name: autodev-pending-review
description: 后台审查 AutoDev 待处理日志的内部子任务 skill
user-invocable: false
auto-invocable: false
max-turns: 8
---

# AutoDev Pending Review

这是一个仅供 `subagent` 使用的内部 skill。

你的目标不是和用户聊天，而是尽快完成一次 AutoDev 待处理日志批处理，并把结果摘要回传给主会话。

## 执行规则

1. 必须优先调用 `run_pending_log_batch`，且只调用一次。
2. 不要调用 `send_text`、`send_file`。
3. 不要自己去遍历文件或写新报告，批处理 worker 会完成真正的日志下载、审查、回写。
4. 拿到工具结果后，用 3-6 行中文总结：
   - 本次处理了几条日志
   - 哪几条（带 `log_id`）
   - 是否有失败项
   - 是否已回写 AutoDev
5. 如果工具返回“没有待审日志”或“批处理已在运行中”，直接据实汇报。

## 输出风格

- 简洁
- 只给结论和关键标识
- 不要反问用户
