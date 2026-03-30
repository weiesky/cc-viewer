# Task

> **Note:** In newer versions of Claude Code, this tool has been renamed to **Agent**. See the [Tool-Agent](Tool-Agent) document.

## Definition

Launches a SubAgent to autonomously handle complex multi-step tasks. SubAgents are independent subprocesses, each with their own dedicated tool set and context.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the task for the SubAgent to execute |
| `description` | string | Yes | A 3-5 word short summary |
| `subagent_type` | string | Yes | SubAgent type, determines the available tool set |
| `model` | enum | No | Specify model (sonnet / opus / haiku), defaults to inheriting from parent |
| `max_turns` | integer | No | Maximum number of agentic turns |
| `run_in_background` | boolean | No | Whether to run in the background; background tasks return an output_file path |
| `resume` | string | No | Agent ID to resume, continues from the last execution |
| `isolation` | enum | No | Isolation mode, `worktree` creates a temporary git worktree |

## SubAgent Types

| Type | Purpose | Available Tools |
|------|---------|-----------------|
| `Bash` | Command execution, git operations | Bash |
| `general-purpose` | General multi-step tasks | All tools |
| `Explore` | Quick codebase exploration | All tools except Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Design implementation plans | All tools except Task/Edit/Write/NotebookEdit/ExitPlanMode |
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
- Multiple Task calls can be issued in parallel within a single message for efficiency
- Background tasks are checked for progress via the TaskOutput tool
- The Explore type is slower than directly calling Glob/Grep; only use it when simple searches are insufficient
