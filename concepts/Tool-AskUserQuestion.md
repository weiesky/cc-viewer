# AskUserQuestion

## 定义

在执行过程中向用户提问，用于获取澄清、验证假设或请求决策。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `questions` | array | 是 | 问题列表（1-4 个问题） |
| `answers` | object | 否 | 用户收集的答案 |
| `annotations` | object | 否 | 每个问题的注释（如预览选择的备注） |
| `metadata` | object | 否 | 跟踪和分析用的元数据 |

每个 `question` 对象：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `question` | string | 是 | 完整的问题文本，应以问号结尾 |
| `header` | string | 是 | 短标签（最多 12 字符），显示为标签芯片 |
| `options` | array | 是 | 2-4 个选项 |
| `multiSelect` | boolean | 是 | 是否允许多选 |

每个 `option` 对象：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `label` | string | 是 | 选项显示文本（1-5 个词） |
| `description` | string | 是 | 选项说明 |
| `markdown` | string | 否 | 预览内容（用于 ASCII 布局、代码片段等的可视化对比） |

## 使用场景

**适合使用：**
- 收集用户偏好或需求
- 澄清模糊的指令
- 在实施过程中获取决策
- 向用户提供方向选择

**不适合使用：**
- 问"方案可以吗？"——应使用 ExitPlanMode

## 注意事项

- 用户始终可以选择 "Other" 提供自定义输入
- 推荐选项放在第一位，并在 label 末尾加 "(Recommended)"
- `markdown` 预览仅支持单选问题
- 有 `markdown` 的选项会切换为左右并排布局
- 在规划模式中，用于在确定方案前澄清需求

## 在 cc-viewer 中的意义

AskUserQuestion 调用在请求日志中表现为 `tool_use` content block，包含问题和选项定义。用户的回答会出现在后续请求的消息历史中。
