# xiaoba-skill-officeCLI

XiaoBa skill 集成包，让 XiaoBa 用户可以直接通过对话创建和编辑 Word、Excel、PPT 文档。

## 包含 Skills

| Skill | 用途 |
|-------|------|
| `officecli-docx` | 创建和编辑 Word 文档（.docx） |
| `officecli-pptx` | 创建和编辑 PPT 演示文稿（.pptx） |
| `officecli-xlsx` | 创建和编辑 Excel 表格（.xlsx） |

## 安装

```bash
xiaoba skill install-github fightheyyy/xiaoba-skill-officeCLI
```

## 使用

安装后直接对 XiaoBa 说：
- "帮我创建一个 Word 报告"
- "做一个销售数据的 Excel 表格"
- "做一个产品介绍的 PPT"

XiaoBa 会自动检测并安装 officecli 工具，然后完成文档操作。

## 声明

本 skill 内容来自 [iOfficeAI/OfficeCLI](https://github.com/iOfficeAI/OfficeCLI)，适配 XiaoBa CLI 使用。
officecli 工具由 iOfficeAI 开发维护。
