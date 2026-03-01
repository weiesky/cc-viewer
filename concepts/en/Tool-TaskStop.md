# TaskStop

## Definition

Stops a running background task.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | No | The background task ID to stop |
| `shell_id` | string | No | Deprecated, use `task_id` instead |

## Use Cases

**Good for:**
- Terminating long-running tasks that are no longer needed
- Canceling erroneously started background tasks

## Notes

- Returns a success or failure status
- The `shell_id` parameter is deprecated; use `task_id` instead

## Significance in cc-viewer

TaskStop calls do not produce API requests themselves; they are internal task management operations in Claude Code.

## Original Text

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
