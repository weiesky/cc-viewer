# TaskList

## Definition

Lists all tasks in the task list to view overall progress and available work.

## Parameters

No parameters.

## Return Content

Summary information for each task:
- `id` — Task identifier
- `subject` — Short description
- `status` — Status: `pending`, `in_progress`, or `completed`
- `owner` — Owner (agent ID), empty means unassigned
- `blockedBy` — List of incomplete task IDs blocking this task

## Use Cases

**Good for:**
- Viewing available tasks (status is pending, no owner, not blocked)
- Checking overall project progress
- Finding blocked tasks
- Finding the next task after completing one

## Notes

- Prefer processing tasks in ID order (lowest ID first), as earlier tasks usually provide context for later ones
- Tasks with `blockedBy` cannot be claimed until dependencies are resolved
- Use TaskGet to get full details of a specific task

## Significance in cc-viewer

TaskList is an internal task management operation and does not produce independent API requests.

## Original Text

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
