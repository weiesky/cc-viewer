# TaskGet

## Definition

Retrieves the full details of a task by its task ID.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | The task ID to retrieve |

## Return Content

- `subject` — Task title
- `description` — Detailed requirements and context
- `status` — Status: `pending`, `in_progress`, or `completed`
- `blocks` — List of tasks blocked by this task
- `blockedBy` — List of prerequisite tasks blocking this task

## Use Cases

**Good for:**
- Getting the full description and context of a task before starting work
- Understanding task dependencies
- Getting complete requirements after being assigned a task

## Notes

- After retrieving a task, check whether the `blockedBy` list is empty before starting work
- Use TaskList to view summary information for all tasks

## Significance in cc-viewer

TaskGet is an internal task management operation and does not produce independent API requests.

## Original Text

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
