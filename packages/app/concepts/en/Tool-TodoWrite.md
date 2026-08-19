# TodoWrite

Writes a structured todo list for the current session, replacing the previous list. Each item carries its text, a status, and a present-continuous form shown in progress indicators.

## When to Use

- A task has several distinct steps and tracking them helps you (and the user) see progress.
- The user explicitly asks for a todo list.
- You want to mark exactly one item as in progress while the rest stay pending or completed.

## Activation

- Legacy tool: disabled by default in sessions that offer the Task tools (`TaskCreate`, `TaskUpdate`, `TaskList`).
- Re-enable it with `CLAUDE_CODE_ENABLE_TASKS=0`.

## Parameters

- `todos` (array, required): The complete updated todo list. Each entry has:
  - `content` (string): The task description.
  - `status` (string): One of `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Present-continuous text shown while the item is in progress (e.g. "Running tests").

## Examples

### Example 1: Track a three-step change

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

The whole list is rewritten on every call — always include all items, not just the ones that changed.

## Notes

- The list is replaced wholesale on each call; to update one item, resubmit every item with the new status.
- Keep exactly one item `in_progress` at a time.
- In sessions where the structured task tools (`TaskCreate`/`TaskUpdate`/`TaskList`) are enabled, the harness may offer those instead of `TodoWrite` — prefer whichever tool set is advertised.
