# CronCreate

Schedule a prompt to be enqueued at a future time, either once or on a recurring basis. Uses standard 5-field cron syntax in the user's local timezone — no timezone conversion required.

## When to Use

- **One-shot reminders**: When a user asks to be reminded at a specific future time ("remind me at 3pm tomorrow"). Set `recurring: false` so the task fires once then is automatically deleted.
- **Recurring schedules**: When a user wants something to happen repeatedly ("every weekday at 9am", "every 30 minutes"). The default `recurring: true` covers this case.
- **Autonomous agent loops**: When building a workflow that needs to re-prompt itself on a schedule — for example, a daily digest or a periodic status check.
- **Durable tasks**: When the schedule must survive a session restart. Pass `durable: true` to write the task to `.claude/scheduled_tasks.json`.
- **Approximate-time requests**: When the user says "around 9am" or "hourly", choose an off-minute value (e.g. `57 8 * * *` or `7 * * * *`) to avoid clustering with other users at :00 or :30.

## Parameters

- `cron` (string, required): A 5-field cron expression in the user's local timezone. Fields are `minute hour day-of-month month day-of-week`. Example: `"0 9 * * 1-5"` means 9:00am Monday–Friday.
- `prompt` (string, required): The prompt text to enqueue when the cron fires. This is the exact message that will be submitted to the REPL at the scheduled time.
- `recurring` (boolean, optional, default `true`): When `true`, the job runs on every matching cron interval and auto-expires after 7 days. When `false`, the job fires exactly once then is automatically deleted — use this for one-shot reminders.
- `durable` (boolean, optional, default `false`): When `false`, the schedule lives only in memory and is lost when the session ends. When `true`, the task is persisted to `.claude/scheduled_tasks.json` and survives restarts.

## Examples

### Example 1: one-shot reminder

User says: "Remind me to send the weekly report tomorrow at 2:30pm." Assuming tomorrow is the 21st of April:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Reminder: send the weekly report now.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` ensures the task deletes itself after firing. `durable: true` keeps it alive across any restarts before then.

### Example 2: recurring weekday morning task

User says: "Every weekday morning, summarize my open GitHub issues."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Summarize all open GitHub issues assigned to me.",
  "recurring": true,
  "durable": true
}
```

Minute `3` instead of `0` avoids the :00 fleet-load spike. The job auto-expires after 7 days.

## Notes

- **7-day auto-expiry**: Recurring jobs fire for at most 7 days, then are deleted automatically. If you need a longer-running schedule, recreate it before it expires.
- **Fires only when idle**: `CronCreate` enqueues the prompt only when the REPL is not processing another query. If the REPL is busy at fire time, the prompt waits until the current query finishes.
- **Avoid :00 and :30 marks**: For approximate-time requests, deliberately choose off-minute values to spread system load. Reserve exact :00/:30 only for when the user specifies that precise minute.
- **No timezone conversion**: The cron expression is interpreted directly in the user's local timezone. There is no need to convert to UTC or any other zone.
