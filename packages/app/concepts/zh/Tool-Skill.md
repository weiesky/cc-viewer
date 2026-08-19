# Skill

在当前对话内调用具名的 skill。Skill 是预打包的能力组合——领域知识、工作流、有时还包含工具权限——由运行时通过系统提醒暴露给助手。

## 何时使用

- 用户输入像 `/review` 或 `/init` 这样的斜杠命令——斜杠命令就是 skill，必须通过本工具执行。
- 用户描述的任务与已公示 skill 的触发条件匹配（例如，请求扫描转录以寻找重复权限弹窗，就匹配 `fewer-permission-prompts`）。
- 某 skill 的声明用途与当前文件、请求或对话上下文直接吻合。
- 可重复的专项工作流已以 skill 形式提供，规范化流程比即兴方式更可取。
- 用户询问「有哪些 skill 可用」——列出公示的名称，仅在他们确认后再调用。

## 参数

- `skill` (string, 必填)：当前 available-skills 系统提醒中列出的 skill 的精确名称。对于带插件命名空间的 skill，使用完整的 `plugin:skill` 形式（例如 `skill-creator:skill-creator`）。不要带前导斜杠。
- `args` (string, 可选)：传给 skill 的自由格式参数。格式与语义由每个 skill 自己的文档定义。

## 示例

### 示例 1：对当前分支运行 review skill

```
Skill(skill="review")
```

`review` skill 封装了针对当前基础分支审查 pull request 的步骤。调用它会把运行时定义的审查流程加载到本轮中。

### 示例 2：调用带插件命名空间并传参的 skill

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

将请求路由到 `skill-creator` 插件的入口，触发创作工作流。

## 注意事项

- 仅调用其名称逐字出现在 available-skills 系统提醒中的 skill，或者用户在消息中以 `/name` 形式直接输入的 skill。永远不要根据记忆或训练数据猜测或编造 skill 名称——若未公示，不要调用本工具。
- 当用户请求与已公示 skill 匹配时，调用 `Skill` 是阻塞性前置：在生成关于该任务的其他回复之前先调用它。不要描述 skill「会做什么」——直接运行它。
- 不要只提 skill 名字而不实际调用。只宣称却不调用是误导。
- 不要用 `Skill` 调用内置 CLI 命令如 `/help`、`/clear`、`/model` 或 `/exit`。那些由运行时直接处理。
- 不要重复调用当前轮已在运行的 skill。如果你看到当前轮内有 `<command-name>` 标签，skill 已加载——请直接遵循其指令，而不是再次调用工具。
- 若多个 skill 都可用，选择最具体的那个。对于添加权限或 hook 等配置改动，优先选 `update-config` 而非通用方式。
- skill 执行可能在本轮剩余部分引入新的系统提醒、工具或约束。skill 完成后请重新阅读对话状态再继续。
