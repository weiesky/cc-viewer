# SendFeedback

在不出会话的情况下，向 Anthropic 发送关于 Claude Code 的结构化反馈——bug 报告、功能想法或缺失的能力。

## 何时使用

- 用户要求报告 bug 或发送关于 Claude Code 本身的反馈。
- 你遇到值得上报的明确产品缺陷（命令失效、行为错误、崩溃）。
- 用户描述了一个希望存在的功能（想法或缺失的能力）。

## 参数

- `type` (string, 必填)：`bug`、`idea`、`missing_capability` 之一。
- `title` (string, 必填)：简短、具体的问题单行摘要。
- `details` (string, 必填)：按顺序排列的带标签要点：**What happened:**（观察到的现象 vs 预期，错误文本较短时附原文）；**What the user said:**（用户原话引用，或 "User didn't comment; observed by the model."）；**Repro:**（最小复现步骤）；**Evidence:**（请求 ID、时间戳、路径、版本——没有则省略）；可选地在末尾附 **Cause:**，仅当在会话内已验证时。每个要点一到三行；不要叙事段落、不要推测、不要秘密。
- `area` (string, 可选)：命名本反馈涉及 Claude Code 哪个部分的简短标签（例如 "hooks config"、"/help"、"file editing"）。不清楚则留空。
- `failure_mode` (string, 可选)：对于模型行为类报告，选择最接近的失败模式（例如 `instruction_following`、`repetition_and_looping`、`context_and_memory`、`stopping_short` 或 `other`）。仅在报告是纯产品/工具 bug 时省略。
- `task_category` (string, 可选)：问题发生时会话正在做什么：`code_edit`、`debug`、`explain`、`plan`、`shell`、`search`、`review` 或 `other`。

## 示例

### 示例 1：报告产品 bug

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## 注意事项

- 永远不要在 `details` 中包含秘密、token 或用户私有数据。
- 尽可能引用用户的原文；否则说明是模型观察到的问题。
- 保持报告基于事实——关于根因的推测只有在会话内已验证时才能写入 `**Cause:**`。
