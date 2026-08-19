# TaskList

Returns every task in the current team (or session) in summarised form. Use it to survey outstanding work, decide what to pick up next, and avoid creating duplicates.

## When to Use

- At the start of a session to see what is already tracked.
- Before calling `TaskCreate`, to confirm the work is not already captured.
- When deciding which task to claim next as a teammate or subagent.
- To verify dependency relationships across the team at a glance.
- Periodically during long sessions to re-sync with teammates who may have claimed, completed, or added tasks.

`TaskList` is read-only and cheap; call it freely whenever you need an overview.

## Activation

- Available by default on most models.
- Not available on Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 and later families (v2.1.233+) unless opted in via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, or `--tools`.
- The whole task system is disabled when `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameters

`TaskList` takes no parameters. It always returns the full task set for the active context.

## Response Shape

Each task in the list is a summary, not the full record. Expect roughly:

- `id` — stable identifier for use with `TaskGet` / `TaskUpdate`.
- `subject` — short imperative title.
- `status` — one of `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — agent or teammate handle, or empty when unclaimed.
- `blockedBy` — array of task IDs that must complete first.

For the full description, acceptance criteria, or metadata of a specific task, follow up with `TaskGet`.

## Examples

### Example 1

Quick status check.

```
TaskList()
```

Scan the output for anything `in_progress` without an `owner` (stale work) and anything `pending` with an empty `blockedBy` (ready to pick up).

### Example 2

Teammate picking the next task.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Notes

- Teammate heuristic: when multiple `pending` tasks are unblocked and unowned, pick the lowest ID. This keeps work FIFO and avoids two agents grabbing the same high-profile task.
- Respect `blockedBy`: do not start a task whose blockers are still `pending` or `in_progress`. Work the blocker first or coordinate with its owner.
- `TaskList` is the only discovery mechanism for tasks. There is no search; if the list is long, scan structurally (by status, then by owner).
- Deleted tasks may still appear in the list with status `deleted` for traceability. Ignore them for planning purposes.
- The list reflects the live state of the team, so teammates may add or claim tasks between calls. Re-list before claiming if time has passed.
