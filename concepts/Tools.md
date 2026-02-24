# Claude Code 工具一览

Claude Code 通过 Anthropic API 的 tool_use 机制向模型提供一组内置工具。每次 MainAgent 请求的 `tools` 数组中包含这些工具的完整 JSON Schema 定义，模型在响应中通过 `tool_use` content block 调用它们。

以下是全部工具的分类索引。

## Agent 系统

| 工具 | 用途 |
|------|------|
| [Task](Tool-Task.md) | 启动子 agent（SubAgent）处理复杂多步骤任务 |
| [TaskOutput](Tool-TaskOutput.md) | 获取后台任务的输出 |
| [TaskStop](Tool-TaskStop.md) | 停止正在运行的后台任务 |
| [TaskCreate](Tool-TaskCreate.md) | 创建结构化任务列表条目 |
| [TaskGet](Tool-TaskGet.md) | 获取任务详情 |
| [TaskUpdate](Tool-TaskUpdate.md) | 更新任务状态、依赖关系等 |
| [TaskList](Tool-TaskList.md) | 列出所有任务 |

## 文件操作

| 工具 | 用途 |
|------|------|
| [Read](Tool-Read.md) | 读取文件内容（支持文本、图片、PDF、Jupyter notebook） |
| [Edit](Tool-Edit.md) | 通过精确字符串替换编辑文件 |
| [Write](Tool-Write.md) | 写入或覆盖文件 |
| [NotebookEdit](Tool-NotebookEdit.md) | 编辑 Jupyter notebook 单元格 |

## 搜索

| 工具 | 用途 |
|------|------|
| [Glob](Tool-Glob.md) | 按文件名模式匹配搜索文件 |
| [Grep](Tool-Grep.md) | 基于 ripgrep 的文件内容搜索 |

## 终端

| 工具 | 用途 |
|------|------|
| [Bash](Tool-Bash.md) | 执行 shell 命令 |

## Web

| 工具 | 用途 |
|------|------|
| [WebFetch](Tool-WebFetch.md) | 抓取网页内容并用 AI 处理 |
| [WebSearch](Tool-WebSearch.md) | 搜索引擎查询 |

## 规划与交互

| 工具 | 用途 |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 进入规划模式，设计实施方案 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 退出规划模式并提交方案供用户审批 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | 向用户提问以获取澄清或决策 |

## 扩展

| 工具 | 用途 |
|------|------|
| [Skill](Tool-Skill.md) | 执行技能（slash command） |

## IDE 集成

| 工具 | 用途 |
|------|------|
| [getDiagnostics](Tool-getDiagnostics.md) | 获取 VS Code 语言诊断信息 |
| [executeCode](Tool-executeCode.md) | 在 Jupyter kernel 中执行代码 |

## 在 cc-viewer 中的意义

工具调用是 Claude Code 请求日志中最核心的可观测数据之一。每个 MainAgent 请求的 `tools` 数组定义了模型可用的工具集，而响应中的 `tool_use` / `tool_result` content block 记录了实际的工具调用与返回。cc-viewer 通过解析这些数据，在 Chat Mode 中还原完整的工具调用链路。

工具定义的变化（如 MCP server 连接/断开导致工具增减）会触发缓存重建，详见 [CacheRebuild](CacheRebuild.md)。
