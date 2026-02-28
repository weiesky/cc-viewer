# Agent

## Definition

Launches a SubAgent to autonomously handle complex multi-step tasks. SubAgents are independent subprocesses, each with their own dedicated tool set and context. Agent is the renamed version of the Task tool in newer Claude Code releases.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the task for the SubAgent to execute |
| `description` | string | Yes | A 3-5 word short summary |
| `subagent_type` | string | Yes | SubAgent type, determines the available tool set |
| `model` | enum | No | Specify model (sonnet / opus / haiku), defaults to inheriting from parent |
| `max_turns` | integer | No | Maximum number of agentic turns |
| `run_in_background` | boolean | No | Whether to run in the background; background tasks return an output_file path |
| `resume` | string | No | Agent ID to resume, continues from the last execution. Useful for picking up where a previous SubAgent left off without losing context |
| `isolation` | enum | No | Isolation mode, `worktree` creates a temporary git worktree |

## SubAgent Types

| Type | Purpose | Available Tools |
|------|---------|-----------------|
| `Bash` | Command execution, git operations | Bash |
| `general-purpose` | General multi-step tasks | All tools |
| `Explore` | Quick codebase exploration | All tools except Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Design implementation plans | All tools except Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Claude Code usage guide Q&A | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configure status bar | Read, Edit |

## Use Cases

**Good for:**
- Complex tasks requiring multi-step autonomous completion
- Codebase exploration and deep research (using Explore type)
- Parallel work requiring isolated environments
- Long-running tasks that need to run in the background

**Not good for:**
- Reading a specific file path — use Read or Glob directly
- Searching within 2-3 known files — use Read directly
- Searching for a specific class definition — use Glob directly

## Notes

- After completion, the SubAgent returns a single message; its results are not visible to the user and need to be relayed by the main agent
- Multiple Agent calls can be issued in parallel within a single message for efficiency
- Background tasks are checked for progress via the TaskOutput tool
- The Explore type is slower than directly calling Glob/Grep; only use it when simple searches are insufficient
- Use `run_in_background: true` for long-running tasks that don't need immediate results; use foreground (default) when the main agent needs the result before proceeding
- The `resume` parameter allows continuing a previously started SubAgent session, preserving its accumulated context

## Significance in cc-viewer

Agent is the new name for the Task tool in recent Claude Code versions. Agent calls produce SubAgent request chains, which appear in the request list as sub-request sequences independent of MainAgent. SubAgent requests typically have streamlined system prompts and fewer tool definitions, forming a clear contrast with MainAgent. In cc-viewer, both `Task` and `Agent` tool names may appear depending on the Claude Code version used in the recorded conversation.
