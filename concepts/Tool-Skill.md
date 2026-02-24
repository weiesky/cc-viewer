# Skill

## 定义

在主对话中执行一个技能（skill）。技能是用户可通过 slash command（如 `/commit`、`/review-pr`）调用的专用能力。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skill` | string | 是 | 技能名称（如 "commit"、"review-pr"、"pdf"） |
| `args` | string | 否 | 技能参数 |

## 使用场景

**适合使用：**
- 用户输入了 `/<skill-name>` 格式的 slash command
- 用户的请求匹配某个已注册技能的功能

**不适合使用：**
- 内置 CLI 命令（如 `/help`、`/clear`）
- 已经在运行中的技能
- 未在可用技能列表中的技能名称

## 注意事项

- 技能被调用后会展开为完整的 prompt
- 支持完全限定名称（如 `ms-office-suite:pdf`）
- 可用技能列表在 system-reminder 消息中提供
- 看到 `<command-name>` 标签时说明技能已加载，应直接执行而非再次调用此工具
- 不要在未实际调用工具的情况下提及某个技能

## 在 cc-viewer 中的意义

Skill 调用在请求日志中表现为 `tool_use` content block。技能展开后的 prompt 会影响后续请求的 system prompt 或消息内容。
