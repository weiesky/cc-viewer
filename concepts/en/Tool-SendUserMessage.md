# SendUserMessage

Sends a message to the user — the primary visible output channel in brief-style sessions. Also known by its legacy alias `Brief`.

## When to Use

- Replying to something the user just said (`status="normal"`).
- Proactively surfacing something the user hasn't asked for and needs to see now — a task completing while they're away, a blocker you hit, an unsolicited status update (`status="proactive"`).

## Parameters

In brief mode:

- `message` (string, required): The message for the user. Supports markdown formatting.
- `attachments` (array, optional): Attachments shown alongside the message. Each entry is either a file path (absolute or relative to cwd) for a locally readable file, or a pre-resolved `{file_uuid, file_name, size, is_image}` object obtained from a device tool such as `attach_file`.
- `status` (string, required): `proactive` for unsolicited updates the user needs now; `normal` when replying to the user.

In non-brief builds only `message` is available.

## Examples

### Example 1: Proactive completion notice

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Notes

- Only enabled in brief mode or via the corresponding feature rollout; most interactive CLI sessions talk to the user directly instead.
- Use `proactive` sparingly — it is meant for things that genuinely need the user's attention now.
