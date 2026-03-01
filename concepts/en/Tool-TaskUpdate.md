# TaskUpdate

## Definition

Updates the status, content, or dependencies of a task in the task list.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | The task ID to update |
| `status` | enum | No | New status: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | No | New title |
| `description` | string | No | New description |
| `activeForm` | string | No | Present continuous text displayed when in progress |
| `owner` | string | No | New task owner (agent name) |
| `metadata` | object | No | Metadata to merge (set to null to delete a key) |
| `addBlocks` | string[] | No | List of task IDs blocked by this task |
| `addBlockedBy` | string[] | No | List of prerequisite task IDs blocking this task |

## Status Workflow

```
pending → in_progress → completed
```

`deleted` can be entered from any status and permanently removes the task.

## Use Cases

**Good for:**
- Marking a task as `in_progress` when starting work
- Marking a task as `completed` when work is done
- Setting dependencies between tasks
- Updating task content when requirements change

**Important rules:**
- Only mark a task as `completed` when it is fully finished
- Keep the task as `in_progress` when encountering errors or blockers
- Do not mark as `completed` if tests are failing, implementation is incomplete, or unresolved errors exist

## Notes

- Before updating, retrieve the task's latest status via TaskGet to avoid stale data
- After completing a task, call TaskList to find the next available task

## Significance in cc-viewer

TaskUpdate is an internal task management operation and does not produce independent API requests.

## Original Text

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
