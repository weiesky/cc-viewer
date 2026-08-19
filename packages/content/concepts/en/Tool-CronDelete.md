# CronDelete

Cancel a cron job previously scheduled with `CronCreate`. Removes it from the in-memory session store immediately; has no effect if the job was already auto-deleted (one-shot jobs are removed after firing, recurring jobs expire after 7 days).

## When to Use

- A user asks to stop a recurring scheduled task before its 7-day auto-expiry.
- A one-shot job is no longer needed and should be cancelled before it fires.
- You need to change the schedule for an existing job — delete it with `CronDelete`, then recreate it with `CronCreate` using the new expression.
- Cleaning up multiple stale jobs to keep the session store tidy.

## Parameters

- `id` (string, required): The job ID returned by `CronCreate` when the job was first created. This value must match exactly; there is no fuzzy or name-based lookup.

## Examples

### Example 1: cancel a running recurring job

A recurring job was created earlier with ID `"cron_abc123"`. The user asks to stop it.

```
CronDelete({ id: "cron_abc123" })
```

The job is removed from the session store and will not fire again.

### Example 2: remove a stale one-shot before it fires

A one-shot job with ID `"cron_xyz789"` was scheduled to run in 30 minutes, but the user has decided it is no longer needed.

```
CronDelete({ id: "cron_xyz789" })
```

The job is cancelled. No action will be taken when the original trigger time arrives.

## Notes

- The `id` must be obtained from the return value of `CronCreate`. There is no way to look up a job by description or callback — store the ID if you may need to cancel later.
- If the job has already been auto-deleted (fired as a one-shot, or reached the 7-day recurring expiry), calling `CronDelete` with that ID is a no-op and will not produce an error.
- `CronDelete` only affects the current in-memory session. If the runtime does not persist cron state across restarts, scheduled jobs are lost on restart regardless of whether `CronDelete` was called.
- There is no bulk-delete operation; cancel each job individually using its own `id`.
