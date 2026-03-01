# TaskOutput

## Definition

Gets the output of a running or completed background task. Applicable to background shells, async agents, and remote sessions.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Task ID |
| `block` | boolean | Yes | Whether to block and wait for task completion, default `true` |
| `timeout` | number | Yes | Maximum wait time in milliseconds, default 30000, max 600000 |

## Use Cases

**Good for:**
- Checking the progress of background agents launched via Task (`run_in_background: true`)
- Getting the execution results of background Bash commands
- Waiting for async tasks to complete and retrieving output

**Not good for:**
- Foreground tasks — foreground tasks return results directly, no need for this tool

## Notes

- `block: true` blocks until the task completes or times out
- `block: false` is for non-blocking checks of the current status
- Task IDs can be found via the `/tasks` command
- Applicable to all task types: background shells, async agents, remote sessions

## Significance in cc-viewer

TaskOutput calls do not produce API requests themselves; they are internal task management operations in Claude Code and do not appear in request logs.

## Original Text

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
