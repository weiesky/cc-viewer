# TaskUpdate

Modifies an existing task — its status, content, ownership, metadata, or dependency edges. This is how tasks progress through their lifecycle and how work is handed off between Claude Code, teammates, and subagents.

## When to Use

- Transitioning a task through the status workflow as you work on it.
- Claiming a task by assigning yourself (or another agent) as `owner`.
- Refining the `subject` or `description` once you learn more about the problem.
- Recording newly discovered dependencies with `addBlocks` / `addBlockedBy`.
- Attaching structured `metadata` such as external ticket IDs or priority hints.

## Activation

- Available by default on most models.
- Not available on Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 and later families (v2.1.233+) unless opted in via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, or `--tools`.
- The whole task system is disabled when `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameters

- `taskId` (string, required): The task to modify. Obtain from `TaskList` or `TaskCreate`.
- `status` (string, optional): One of `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, optional): Replacement imperative title.
- `description` (string, optional): Replacement detailed description.
- `activeForm` (string, optional): Replacement present-continuous spinner text.
- `owner` (string, optional): Agent or teammate handle taking responsibility for the task.
- `metadata` (object, optional): Metadata keys to merge into the task. Set a key to `null` to delete it.
- `addBlocks` (array of strings, optional): Task IDs that this task blocks.
- `addBlockedBy` (array of strings, optional): Task IDs that must complete before this one.

## Status Workflow

The lifecycle is deliberately linear: `pending` → `in_progress` → `completed`. `deleted` is terminal and used to retract tasks that will never be worked on.

- Set `in_progress` the moment you actually begin work, not before. Only one task at a time should be `in_progress` for a given owner.
- Set `completed` only when the work is fully done — acceptance criteria met, tests passing, output written. If a blocker appears, keep the task `in_progress` and add a new task describing what needs to be resolved.
- Never mark a task `completed` when tests are failing, the implementation is partial, or you hit unresolved errors.
- Use `deleted` for tasks that are cancelled or duplicate; do not repurpose a task for unrelated work.

## Examples

### Example 1

Claim a task and start it.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Example 2

Finish the work and record a follow-up dependency.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Notes

- `metadata` merges key by key; passing `null` for a key removes it. Call `TaskGet` first if you are unsure of the current contents.
- `addBlocks` and `addBlockedBy` append edges; they do not remove existing ones. Editing the graph destructively requires a dedicated workflow — consult the team owner before rewriting dependencies.
- Keep `activeForm` in sync when you change `subject` so the spinner text continues to read naturally.
- Do not mark a task `completed` to silence it. If the user cancelled the work, use `deleted` with a brief rationale in `description`.
- Read a task's latest state with `TaskGet` before updating — teammates may have changed it between your last read and your write.
