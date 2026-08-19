# TaskGet

Fetches the full record for a single task by ID, including its description, current status, owner, metadata, and dependency edges. Use it when the summary returned by `TaskList` is not enough to act on the task.

## When to Use

- You picked up a task from `TaskList` and need the full description before starting work.
- You are about to mark a task `completed` and want to re-check the acceptance criteria.
- You need to inspect which tasks this one `blocks` or is `blockedBy` to decide the next move.
- You are investigating history — who owns it, what metadata was attached, when it changed state.
- A teammate or prior session referenced a task ID and you need the context.

Prefer `TaskList` when you only need a high-level scan; reserve `TaskGet` for the specific record you intend to read carefully or modify.

## Activation

- Available by default on most models.
- Not available on Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 and later families (v2.1.233+) unless opted in via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, or `--tools`.
- The whole task system is disabled when `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameters

- `taskId` (string, required): The task identifier returned by `TaskCreate` or `TaskList`. IDs are stable for the life of the task.

## Examples

### Example 1

Look up a task you just saw in the list.

```
TaskGet(taskId: "t_01HXYZ...")
```

Typical response fields: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Example 2

Resolve dependencies before starting.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Notes

- `TaskGet` is read-only and safe to call repeatedly; it does not change status or ownership.
- If `blockedBy` is non-empty and contains tasks that are not `completed`, do not start this task — resolve the blockers first (or coordinate with their owner).
- The `description` field can be long. Read it fully before acting; skimming leads to missed acceptance criteria.
- An unknown or deleted `taskId` returns an error. Re-run `TaskList` to pick a current ID.
- If you are about to edit a task, call `TaskGet` first to avoid overwriting fields a teammate just changed.
