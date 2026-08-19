# TaskOutput

Fetches the accumulated output of a running or completed background task — a background shell command, a local agent, or a remote session. Use it when you need to inspect what a long-running task has produced so far.

## When to Use

- A remote session (for example a cloud sandbox) is running and you need its stdout.
- A local agent was dispatched in the background and you want partial progress before it returns.
- A background shell command has been running long enough that you want to check on it without stopping it.
- You need to confirm a background task is actually making progress before waiting longer or calling `TaskStop`.

Do not reach for `TaskOutput` reflexively. For most background work there is a more direct path — see the notes below.

## Parameters

- `task_id` (string, required): The task identifier returned when the background work was started. Not the same as a task-list `taskId`; this is the runtime handle for the specific execution.
- `block` (boolean, optional): When `true` (default), wait until the task produces new output or finishes before returning. When `false`, return immediately with whatever is buffered.
- `timeout` (number, optional): Maximum milliseconds to block before returning. Only meaningful when `block` is `true`. Default `30000`, maximum `600000`.

## Examples

### Example 1

Peek at a remote session without blocking.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Returns whatever stdout/stderr has been produced since the task started (or since your last `TaskOutput` call, depending on the runtime).

### Example 2

Wait briefly for a local agent to emit more output.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Notes

- Background bash commands: `TaskOutput` is effectively deprecated for this use case. When you start a background shell task the result already includes the path to its output file — read that path directly with the `Read` tool. `Read` gives you random access, line offsets, and a stable view; `TaskOutput` does not.
- Local agents (the `Agent` tool dispatched in the background): when the agent finishes, the `Agent` tool result already contains its final response. Use that directly. Do not `Read` the symlinked transcript file — it contains the full tool-call stream and will overflow the context window.
- Remote sessions: `TaskOutput` is the correct and often only way to stream back output. Prefer `block: true` with a modest `timeout` over tight polling loops.
- An unknown `task_id`, or a task whose output has been garbage-collected, returns an error. Re-dispatch the work if you still need it.
- `TaskOutput` does not stop the task. Use `TaskStop` to terminate.
