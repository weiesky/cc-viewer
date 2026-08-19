# Monitor

Start a background monitor that streams events from a long-running script. Each stdout line becomes a notification — keep working while events arrive in chat.

## When to Use

- Tailing a log file for errors, warnings, or crash signatures while a deployment runs
- Polling a remote API, PR, or CI pipeline every 30 seconds for new status events
- Watching a filesystem directory or build output for changes as they happen
- Waiting for a specific condition across many iterations (e.g., a training step milestone or a queue draining)
- **Not** for simple "wait until done" — use `Bash` with `run_in_background` for that; it emits one completion notification when the process exits

## Activation

- Off by default (server-side feature flag).
- Unavailable on Amazon Bedrock, Google Cloud, and Microsoft Foundry.
- Off when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.
- The WebSocket source requires Claude Code 2.1.195+.

## Parameters

- `command` (string, required): The shell command or script to run. Each line written to stdout becomes a separate notification event. The monitor ends when the process exits.
- `description` (string, required): A short human-readable label shown in every notification. Be specific — "errors in deploy.log" is better than "watching logs". This label is how you identify which monitor fired.
- `timeout_ms` (number, default `300000`, max `3600000`): Kill deadline in milliseconds. After this duration the process is terminated. Ignored when `persistent: true`.
- `persistent` (boolean, default `false`): When `true`, the monitor runs for the lifetime of the session with no timeout. Stop it explicitly with `TaskStop`.

## Examples

### Example 1: Tail a log file for errors and crashes

This example covers terminal states: success marker, traceback, common error keywords, OOM kill, and unexpected process death.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Use `grep --line-buffered` in every pipe. Without it the operating system buffers output in 4 KB blocks and events can be delayed by minutes. The alternation pattern covers both the happy path (`deployed`) and failure paths (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). A monitor that only watches for success stays silent through a crash — silence looks identical to "still running".

### Example 2: Poll a remote API every 30 seconds for new events

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` prevents a transient network failure from killing the loop. Poll intervals of 30 seconds or more are appropriate for remote APIs to avoid rate limits. Adjust the grep pattern to capture both success and failure responses so silence cannot mask an API-side error.

## Notes

- **Always use `grep --line-buffered` in pipes.** Without it, pipe buffering delays events by minutes because the OS accumulates output until a 4 KB block fills. `--line-buffered` forces a flush after every line.
- **Filter must cover both success and failure signatures.** A monitor watching only for the success marker goes silent on a crash, hang, or unexpected exit. Widen the alternation: include `Error`, `Traceback`, `FAILED`, `Killed`, `OOM`, and similar terminal-state markers alongside the success keyword.
- **Poll intervals: 30 seconds or more for remote APIs.** Tight polling loops on external services risk rate-limit errors or bans. For local filesystem or process checks, 0.5–1 second is appropriate.
- **Use `persistent: true` for session-lifetime monitors.** The default `timeout_ms` of 300 000 ms (5 minutes) terminates the process. For monitors that should run until you explicitly stop them, set `persistent: true` and call `TaskStop` when done.
- **Auto-stop on event flood.** Every stdout line is a conversation message. If the filter is too broad and produces too many events, the monitor is automatically stopped. Restart with a tighter `grep` pattern. Lines arriving within 200 ms are batched into a single notification.
