# Claude Code Tools Overview

Claude Code provides a set of built-in tools to the model through the Anthropic API's tool_use mechanism. Each MainAgent request includes the complete JSON Schema definitions of these tools in the `tools` array, and the model invokes them via `tool_use` content blocks in its responses.

Below is a categorized index of all tools.

## Agent System

| Tool | Purpose |
|------|---------|
| [Task](Tool-Task.md) | Launch a SubAgent to handle complex multi-step tasks |
| [TaskOutput](Tool-TaskOutput.md) | Get the output of a background task |
| [TaskStop](Tool-TaskStop.md) | Stop a running background task |
| [TaskCreate](Tool-TaskCreate.md) | Create a structured task list entry |
| [TaskGet](Tool-TaskGet.md) | Get task details |
| [TaskUpdate](Tool-TaskUpdate.md) | Update task status, dependencies, etc. |
| [TaskList](Tool-TaskList.md) | List all tasks |

## File Operations

| Tool | Purpose |
|------|---------|
| [Read](Tool-Read.md) | Read file contents (supports text, images, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | Edit files via exact string replacement |
| [Write](Tool-Write.md) | Write to or overwrite files |
| [NotebookEdit](Tool-NotebookEdit.md) | Edit Jupyter notebook cells |

## Search

| Tool | Purpose |
|------|---------|
| [Glob](Tool-Glob.md) | Search files by filename pattern matching |
| [Grep](Tool-Grep.md) | Search file contents based on ripgrep |

## Terminal

| Tool | Purpose |
|------|---------|
| [Bash](Tool-Bash.md) | Execute shell commands |

## Web

| Tool | Purpose |
|------|---------|
| [WebFetch](Tool-WebFetch.md) | Fetch web page content and process it with AI |
| [WebSearch](Tool-WebSearch.md) | Search engine queries |

## Planning & Interaction

| Tool | Purpose |
|------|---------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Enter plan mode to design an implementation plan |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Exit plan mode and submit the plan for user approval |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Ask the user a question for clarification or decisions |

## Extensions

| Tool | Purpose |
|------|---------|
| [Skill](Tool-Skill.md) | Execute a skill (slash command) |

## IDE Integration

| Tool | Purpose |
|------|---------|
| [getDiagnostics](Tool-getDiagnostics.md) | Get VS Code language diagnostics |
| [executeCode](Tool-executeCode.md) | Execute code in a Jupyter kernel |
