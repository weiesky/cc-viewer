# RemoteTrigger

Call the claude.ai remote-trigger API to manage scheduled and on-demand trigger execution. The OAuth token is handled internally and is never exposed to the model or shell.

## When to Use

- Managing scheduled remote agents (triggers) on claude.ai, including listing, inspecting, and updating existing ones
- Creating a new cron-based automated task that runs a Claude agent on a recurring schedule
- Firing an existing trigger on demand without waiting for its next scheduled run
- Listing or auditing all current triggers to review their configuration and status
- Updating trigger settings such as schedule, payload, or description without recreating the trigger

## Activation

- Requires a claude.ai Pro, Max, Team, or Enterprise plan.
- Not available on Amazon Bedrock, Claude Platform on AWS, Google Cloud, or Microsoft Foundry.
- Requires server-side feature flags and the `allow_remote_sessions` / `allow_routines` policy settings.
- Not for remote sessions themselves.

## Parameters

- `action` (string, required): the operation to perform — one of `list`, `get`, `create`, `update`, or `run`
- `trigger_id` (string, required for `get`, `update`, and `run`): the identifier of the trigger to operate on; must match the pattern `^[\w-]+$` (word characters and dashes only)
- `body` (object, required for `create` and `update`; optional for `run`): the request payload sent to the API

## Examples

### Example 1: list all triggers

```json
{
  "action": "list"
}
```

This calls `GET /v1/code/triggers` and returns a JSON array of all triggers associated with the authenticated account.

### Example 2: create a new trigger that runs every weekday morning

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Generate a daily summary every weekday at 08:00 UTC"
  }
}
```

This calls `POST /v1/code/triggers` with the provided body and returns the newly created trigger object, including its assigned `trigger_id`.

### Example 3: fire a trigger on demand

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

This calls `POST /v1/code/triggers/my-report-trigger/run` immediately, bypassing the scheduled time.

### Example 4: fetch a single trigger

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

This calls `GET /v1/code/triggers/my-report-trigger` and returns the full trigger configuration.

## Notes

- The OAuth token is injected in-process by the tool — never copy, paste, or log tokens manually; doing so creates a security risk and is unnecessary when using this tool.
- Prefer this tool over raw `curl` or other HTTP clients for all trigger API calls; using direct HTTP bypasses the secure token injection and may expose credentials.
- The tool returns the raw JSON response from the API; the caller is responsible for parsing the response and handling error status codes.
- The `trigger_id` value must match the pattern `^[\w-]+$` — only alphanumeric characters, underscores, and dashes are permitted; spaces or special characters will cause the request to fail.
