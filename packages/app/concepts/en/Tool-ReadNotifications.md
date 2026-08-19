# ReadNotifications

Reads notifications queued for the assistant in the current session — GitHub activity on subscribed PRs (`github_webhook`), scheduled-trigger fires (`trigger_fire`), and messages arriving from other Claude sessions (`mcp_send_message`).

## When to Use

- You were notified that something happened — a subscribed PR updated, a scheduled trigger fired, another session messaged you — and need the actual payload.
- Draining a backlog: large batches are returned in parts, so keep calling until the result reports 0 `remaining`.

## Parameters

This tool takes no parameters.

## Examples

### Example 1: Drain pending notifications

```
ReadNotifications()
```

Returns queued notifications oldest first. The result includes a `remaining` count of notifications still queued after this drain — call the tool again to read them.

## Notes

- Drains are size-budgeted: a follow-up call returns the rest of the SAME queue (plus anything newly arrived), not only new arrivals. Loop until `remaining` is 0.
- Notifications originate from GitHub webhooks on subscribed PRs, scheduled triggers, and messages from other Claude sessions; there is no filtering parameter in the current version.
