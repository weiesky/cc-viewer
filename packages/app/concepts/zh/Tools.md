# Claude Code 工具一览

Claude Code 通过 Anthropic API 的 tool_use 机制向模型提供一组内置工具。每次 MainAgent 请求的 `tools` 数组中包含这些工具的完整 JSON Schema 定义，模型在响应中通过 `tool_use` content block 调用它们。

以下是全部工具的分类索引。

## Agent 系统

| 工具 | 用途 |
|------|------|
| [Agent](Tool-Agent.md) | 启动子 agent（SubAgent）处理复杂多步骤任务 |
| [TaskOutput](Tool-TaskOutput.md) | 获取后台任务的输出 |
| [TaskStop](Tool-TaskStop.md) | 停止正在运行的后台任务 |
| [TaskCreate](Tool-TaskCreate.md) | 创建结构化任务列表条目 |
| [TaskGet](Tool-TaskGet.md) | 获取任务详情 |
| [TaskUpdate](Tool-TaskUpdate.md) | 更新任务状态、依赖关系等 |
| [TaskList](Tool-TaskList.md) | 列出所有任务 |
| [ListAgents](Tool-ListAgents.md) | 列出会话中可用的 agent |

## 文件操作

| 工具 | 用途 |
|------|------|
| [Read](Tool-Read.md) | 读取文件内容（支持文本、图片、PDF、Jupyter notebook） |
| [Edit](Tool-Edit.md) | 通过精确字符串替换编辑文件 |
| [Write](Tool-Write.md) | 写入或覆盖文件 |
| [NotebookEdit](Tool-NotebookEdit.md) | 编辑 Jupyter notebook 单元格 |

## 团队与协作

| 工具 | 用途 |
|------|------|
| [SendMessage](Tool-SendMessage.md) | 向另一个 agent 发送消息 |
| [Workflow](Tool-Workflow.md) | 运行确定性多 agent 编排脚本 |
| [Monitor](Tool-Monitor.md) | 将长时间运行脚本的事件流式推送为通知 |
| [SendFile](Tool-SendFile.md) | 向另一个 Claude Code 会话发送文件 |
| [SendUserFile](Tool-SendUserFile.md) | 向用户发送文件 |
| [SendUserMessage](Tool-SendUserMessage.md) | 向用户发送消息（旧版 Brief 工具） |
| [EndConversation](Tool-EndConversation.md) | 结束当前对话 |

## 搜索

| 工具 | 用途 |
|------|------|
| [Glob](Tool-Glob.md) | 按文件名模式匹配搜索文件 |
| [Grep](Tool-Grep.md) | 基于 ripgrep 的文件内容搜索 |
| [ToolSearch](Tool-ToolSearch.md) | 按需搜索并加载延迟/MCP 工具 |

## 终端

| 工具 | 用途 |
|------|------|
| [Bash](Tool-Bash.md) | 执行 shell 命令 |
| [REPL](Tool-REPL.md) | 在持久化 Node.js REPL 中运行 JavaScript |

## Web

| 工具 | 用途 |
|------|------|
| [WebFetch](Tool-WebFetch.md) | 抓取网页内容并用 AI 处理 |
| [WebSearch](Tool-WebSearch.md) | 搜索引擎查询 |
| [Artifact](Tool-Artifact.md) | 将 HTML/Markdown 文件发布为托管的 claude.ai 网页 |
| [DesignSync](Tool-DesignSync.md) | 将本地组件库与 claude.ai 设计系统项目同步 |

## 规划与交互

| 工具 | 用途 |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | 进入规划模式，设计实施方案 |
| [ExitPlanMode](Tool-ExitPlanMode.md) | 退出规划模式并提交方案供用户审批 |
| [AskUserQuestion](Tool-AskUserQuestion.md) | 向用户提问以获取澄清或决策 |
| [ReportFindings](Tool-ReportFindings.md) | 将代码审查发现报告为主机 UI 的类型化列表 |
| [TodoWrite](Tool-TodoWrite.md) | 为会话写入结构化 todo 列表 |
| [SendFeedback](Tool-SendFeedback.md) | 向 Anthropic 发送关于 Claude Code 的结构化反馈 |
| [Projects](Tool-Projects.md) | 管理项目知识库文档 |
| [ProposeGoal](Tool-ProposeGoal.md) | 为会话提出可验证的完成目标 |

## 工作树

| 工具 | 用途 |
|------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | 为会话创建或进入隔离的 git worktree |
| [ExitWorktree](Tool-ExitWorktree.md) | 离开 worktree 会话，保留或删除它 |

## 计划与通知

| 工具 | 用途 |
|------|------|
| [CronCreate](Tool-CronCreate.md) | 在 cron 表达式上安排提示（循环或一次性） |
| [CronDelete](Tool-CronDelete.md) | 取消已安排的 cron 作业 |
| [CronList](Tool-CronList.md) | 列出已安排的 cron 作业 |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | 通过安排下一次唤醒来自行调整 /loop 迭代 |
| [PushNotification](Tool-PushNotification.md) | 向用户发送桌面/移动通知 |
| [RemoteTrigger](Tool-RemoteTrigger.md) | 管理 claude.ai 远程触发例程 |
| [ReadNotifications](Tool-ReadNotifications.md) | 读取会话中待处理的通知 |

## 扩展

| 工具 | 用途 |
|------|------|
| [Skill](Tool-Skill.md) | 执行技能（slash command） |

## MCP 与扩展

| 工具 | 用途 |
|------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | 列出已连接 MCP 服务器暴露的资源 |
| [ReadMcpResource](Tool-ReadMcpResource.md) | 按 URI 读取单个 MCP 服务器资源 |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | 按 URI 列出目录型 MCP 资源 |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | 按关键词搜索 MCP 连接器注册表 |
| [SuggestConnectors](Tool-SuggestConnectors.md) | 从注册表搜索结果中解析连接器详情 |
| [ListConnectors](Tool-ListConnectors.md) | 列出已安装的 MCP 连接器 |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | 渲染内联插件安装卡片 |
| [SuggestSkills](Tool-SuggestSkills.md) | 渲染可添加 skill 的卡片 |
| [ListPlugins](Tool-ListPlugins.md) | 列出已启用的 claude.ai 插件 |
| [ListSkills](Tool-ListSkills.md) | 列出已启用的 claude.ai skill |

## IDE 集成

| 工具 | 用途 |
|------|------|
| [LSP](Tool-LSP.md) | 语言服务器查询（定义、引用、符号） |
