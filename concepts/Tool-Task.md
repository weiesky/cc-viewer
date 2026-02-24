# Task

## 定义

启动一个子 agent（SubAgent）来自主处理复杂的多步骤任务。子 agent 是独立的子进程，拥有各自专用的工具集和上下文。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 子 agent 要执行的任务描述 |
| `description` | string | 是 | 3-5 个词的简短摘要 |
| `subagent_type` | string | 是 | 子 agent 类型，决定可用工具集 |
| `model` | enum | 否 | 指定模型（sonnet / opus / haiku），默认继承父级 |
| `max_turns` | integer | 否 | 最大 agentic 轮次数 |
| `run_in_background` | boolean | 否 | 是否后台运行，后台任务返回 output_file 路径 |
| `resume` | string | 否 | 要恢复的 agent ID，从上次执行继续 |
| `isolation` | enum | 否 | 隔离模式，`worktree` 创建临时 git worktree |

## 子 agent 类型

| 类型 | 用途 | 可用工具 |
|------|------|----------|
| `Bash` | 命令执行，git 操作 | Bash |
| `general-purpose` | 通用多步骤任务 | 全部工具 |
| `Explore` | 快速探索代码库 | 除 Task/Edit/Write/NotebookEdit/ExitPlanMode 外的所有工具 |
| `Plan` | 设计实施方案 | 除 Task/Edit/Write/NotebookEdit/ExitPlanMode 外的所有工具 |
| `claude-code-guide` | Claude Code 使用指南问答 | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | 配置状态栏 | Read, Edit |

## 使用场景

**适合使用：**
- 需要多步骤自主完成的复杂任务
- 代码库探索和深度研究（使用 Explore 类型）
- 需要隔离环境的并行工作
- 需要后台运行的长时间任务

**不适合使用：**
- 读取特定文件路径——直接用 Read 或 Glob
- 在 2-3 个已知文件中搜索——直接用 Read
- 搜索特定类定义——直接用 Glob

## 注意事项

- 子 agent 完成后返回单条消息，其结果对用户不可见，需要主 agent 转述
- 可以在单条消息中发起多个并行 Task 调用以提高效率
- 后台任务通过 TaskOutput 工具检查进度
- Explore 类型比直接调用 Glob/Grep 慢，仅在简单搜索不够时使用

## 在 cc-viewer 中的意义

Task 调用会产生 SubAgent 请求链路，在请求列表中可以看到独立于 MainAgent 的子请求序列。SubAgent 请求通常具有精简的 system prompt 和较少的工具定义，与 MainAgent 形成明显对比。
