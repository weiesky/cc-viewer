# AskUserQuestion

在聊天界面中向用户呈现一个或多个结构化的多选题，收集其选择并返回给助手——适用于无需自由文本往返即可澄清意图的场景。

## 何时使用

- 请求存在多种合理解读，助手需要用户先选定一种再继续。
- 用户必须在具体选项（框架、库、文件路径、策略）中做出选择，此时自由文本回复容易出错。
- 你希望通过预览面板并排比较候选方案。
- 若干相关决策可以合并为单次提问，从而减少来回交流。
- 某个计划或工具调用依赖于用户尚未指定的配置。

## 参数

- `questions` (array, 必填)：一个提示中同时展示 1 到 4 个问题。每个问题对象包含：
  - `question` (string, 必填)：问题的完整文本，以问号结尾。
  - `header` (string, 必填)：短标签（最多 12 个字符），作为问题上方的小芯片渲染。
  - `options` (array, 必填)：2 到 4 个选项对象。每个选项包含 `label`（1-5 个词）、`description` 和可选的 `markdown` 预览。
  - `multiSelect` (boolean, 必填)：为 `true` 时允许用户选择多项。

## 示例

### 示例 1：选择单一框架

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### 示例 2：两种布局的并排预览

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## 注意事项

- UI 会自动为每个问题追加一个「Other」自由文本选项。不要自行添加「Other」「None」或「Custom」条目——否则会与内置的兜底入口重复。
- 每次调用限制在 1 到 4 个问题，每个问题限制在 2 到 4 个选项。超出上限会被运行时拒绝。
- 若你推荐某一选项，请将它放在首位，并在其 label 后追加「(Recommended)」，以便 UI 高亮推荐路径。
- 通过 `markdown` 字段提供的预览仅支持单选题。用于 ASCII 布局、代码片段、配置差异等视觉工件，而不是只需 label 加 description 就够的简单偏好选择。
- 当问题中任一选项带有 `markdown` 值时，UI 会切换为左侧选项列表、右侧预览的并排布局。
- 不要用 `AskUserQuestion` 询问「这个计划看起来如何？」——请改用 `ExitPlanMode`，它正是用于计划审批。在计划模式下，也请避免在问题文本中提及「the plan」，因为在 `ExitPlanMode` 运行之前用户看不到计划。
- 不要使用本工具请求 API 密钥、密码等敏感或自由格式的输入。请改为在聊天中直接询问。
