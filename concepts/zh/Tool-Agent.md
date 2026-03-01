# Agent

## 定义

启动一个子 agent（SubAgent）来自主处理复杂的多步骤任务。子 agent 是独立的子进程，拥有各自专用的工具集和上下文。Agent 是新版 Claude Code 中 Task 工具的重命名版本。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 子 agent 要执行的任务描述 |
| `description` | string | 是 | 3-5 个词的简短摘要 |
| `subagent_type` | string | 是 | 子 agent 类型，决定可用工具集 |
| `model` | enum | 否 | 指定模型（sonnet / opus / haiku），默认继承父级 |
| `max_turns` | integer | 否 | 最大 agentic 轮次数 |
| `run_in_background` | boolean | 否 | 是否后台运行，后台任务返回 output_file 路径 |
| `resume` | string | 否 | 要恢复的 agent ID，从上次执行继续。适用于在不丢失上下文的情况下接续之前的子 agent |
| `isolation` | enum | 否 | 隔离模式，`worktree` 创建临时 git worktree |

## 子 agent 类型

| 类型 | 用途 | 可用工具 |
|------|------|----------|
| `Bash` | 命令执行，git 操作 | Bash |
| `general-purpose` | 通用多步骤任务 | 全部工具 |
| `Explore` | 快速探索代码库 | 除 Agent/Edit/Write/NotebookEdit/ExitPlanMode 外的所有工具 |
| `Plan` | 设计实施方案 | 除 Agent/Edit/Write/NotebookEdit/ExitPlanMode 外的所有工具 |
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
- 可以在单条消息中发起多个并行 Agent 调用以提高效率
- 后台任务通过 TaskOutput 工具检查进度
- Explore 类型比直接调用 Glob/Grep 慢，仅在简单搜索不够时使用
- 长时间运行且不需要立即结果的任务建议使用 `run_in_background: true`；需要结果后才能继续时使用前台模式（默认）
- `resume` 参数允许继续之前启动的子 agent 会话，保留其积累的上下文

## 在 cc-viewer 中的意义

Agent 是新版 Claude Code 中 Task 工具的新名称。Agent 调用会产生 SubAgent 请求链路，在请求列表中可以看到独立于 MainAgent 的子请求序列。SubAgent 请求通常具有精简的 system prompt 和较少的工具定义，与 MainAgent 形成明显对比。在 cc-viewer 中，根据录制对话时使用的 Claude Code 版本不同，可能会出现 `Task` 或 `Agent` 两种工具名称。

## 原文

<textarea readonly>Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- statusline-setup: Use this agent to configure the user's Claude Code status line setting. (Tools: Read, Edit)
- Explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- claude-code-guide: Use this agent when the user asks questions ("Can Claude...", "Does Claude...", "How do I...") about: (1) Claude Code (the CLI tool) - features, hooks, slash commands, MCP servers, settings, IDE integrations, keyboard shortcuts; (2) Claude Agent SDK - building custom agents; (3) Claude API (formerly Anthropic API) - API usage, tool use, Anthropic SDK usage. **IMPORTANT:** Before spawning a new agent, check if there is already a running or recently completed claude-code-guide agent that you can resume using the "resume" parameter. (Tools: Glob, Grep, Read, WebFetch, WebSearch)

When using the Agent tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Agent tool:
- If you want to read a specific file path, use the Read or Glob tool instead of the Agent tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Agent tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above


Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed — e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.
- Agents can be resumed using the `resume` parameter by passing the agent ID from a previous invocation. When resumed, the agent continues with its full previous context preserved. When NOT resuming, each invocation starts fresh and you should provide a detailed task description with all necessary context.
- When the agent is done, it will return a single message back to you along with its agent ID. You can use this ID to resume the agent later if needed for follow-up work.
- Provide clear, detailed prompts so the agent can work autonomously and return exactly the information you need.
- Agents with "access to current context" can see the full conversation history before the tool call. When using these agents, you can write concise prompts that reference earlier context (e.g., "investigate the error discussed above") instead of repeating information. The agent will receive all prior messages and understand the context.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Agent tool use content blocks. For example, if you need to launch both a build-validator agent and a test-runner agent in parallel, send a single message with both tool calls.
- You can optionally set `isolation: "worktree"` to run the agent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the agent makes no changes; if changes are made, the worktree path and branch are returned in the result.

Example usage:

<example_agent_descriptions>
"test-runner": use this agent after you are done writing code to run tests
"greeting-responder": use this agent to respond to user greetings with a friendly joke
</example_agent_descriptions>

<example>
user: "Please write a function that checks if a number is prime"
assistant: Sure let me write a function that checks if a number is prime
assistant: First let me use the Write tool to write a function that checks if a number is prime
assistant: I'm going to use the Write tool to write the following code:
<code>
function isPrime(n) {
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false
  }
  return true
}
</code>
<commentary>
Since a significant piece of code was written and the task was completed, now use the test-runner agent to run the tests
</commentary>
assistant: Now let me use the test-runner agent to run the tests
assistant: Uses the Agent tool to launch the test-runner agent
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the Agent tool to launch the greeting-responder agent"
</example>
</textarea>
