# Roles 目录说明

`roles/` 用来存放 XiaoBa Runtime 的角色定义。

每个角色都应该放在独立目录下，并至少包含以下内容：

```text
roles/
└── <role-name>/
    ├── README.md
    ├── role.json
    ├── prompts/
    └── skills/
```

## 约定

- `README.md`：说明这个角色的定位、职责、适用场景和使用方式
- `role.json`：声明角色名称、描述、prompt 文件和 skill 继承策略
- `prompts/`：存放角色专属 prompt
- `skills/`：存放角色专属 skills

## 设计原则

- 只维护一套 `XiaoBa-CLI` runtime
- 公共能力保留在主 runtime 中
- 角色差异通过 `roles/<role>/` 覆盖和扩展
- 角色专属能力只在对应 role 激活时加载

## 使用方式

```bash
xiaoba --role <role-name>
```

示例：

```bash
xiaoba --role inspector-cat
```
