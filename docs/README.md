# XiaoBa-CLI Docs

根目录 [`../SPEC.md`](../SPEC.md) 是 XiaoBa-CLI 唯一的整体架构 spec。`docs/` 下的文档只作为专题说明、运维记录或技术参考。

## 文档结构

```text
docs/
├── README.md                 # 文档索引和维护规则
├── SPEC.md                   # 历史链接兼容入口，指向 ../SPEC.md
├── ops/                      # 发布、自动更新、运维流程
├── reference/                # 专题设计和历史技术参考
└── proposal-assets/          # README / proposal 使用的图片资产
```

## 必读文档

- [Architecture Spec](../SPEC.md)
- [CD / Release](./ops/CD_RELEASE.md)
- [Auto Update](./ops/AUTO_UPDATE.md)

## 专题参考

- [Message Runtime](./reference/message-runtime.md)
- [Replay Loop](./reference/replay-loop.md)
- [Post-Training](./reference/post-training.md)

## 维护规则

- 整体架构变更只更新根目录 `SPEC.md`；专题文档不能替代总 spec。
- 发布、自动更新和运维流程放在 `ops/`。
- 仍有参考价值但不是当前架构真相源的设计文档放在 `reference/`。
