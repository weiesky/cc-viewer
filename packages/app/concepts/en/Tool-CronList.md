# CronList

List all cron jobs scheduled via `CronCreate` in the current session. Returns a summary of each active cron including its `id`, cron expression, abbreviated `prompt`, `recurring` flag, `durable` flag, and next scheduled fire time.

## When to Use

- Audit what jobs are currently scheduled before making changes or ending a session.
- Find the correct `id` of a job before calling `CronDelete` to remove it.
- Debug why an expected job never fired by confirming it exists and checking its next fire time.
- Confirm that a one-shot (non-recurring) job has not yet fired and is still pending.

## Parameters

None.

## Examples

### Example 1: audit all scheduled jobs

Call `CronList` with no arguments to retrieve the full list of active cron jobs. The response includes each job's `id`, the cron expression defining its schedule, a truncated version of the `prompt` it will execute, whether it is `recurring`, whether it is `durable` across restarts, and the next time it is scheduled to fire.

### Example 2: locate the id of a specific recurring task

If you created multiple cron jobs and need to delete one specific recurring task, call `CronList` first. Scan the returned list for the job whose `prompt` summary and cron expression match the task you want to remove. Copy its `id` and pass it to `CronDelete`.

## Notes

- Only jobs created in the current session are listed unless they were created with `durable: true`, which allows them to persist across session restarts.
- The `prompt` field in the summary is truncated; it shows only the beginning of the full prompt text, not the complete instruction.
- One-shot jobs (where `recurring` is `false`) that have already fired are automatically deleted and will no longer appear in the list.
