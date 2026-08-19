# TaskStop

Stops a running background task — a shell command, a dispatched agent, or a remote session — by its runtime handle. Use it to reclaim resources, cancel work that is no longer useful, or recover when a task is stuck.

## When to Use

- A background shell command has run longer than expected and you no longer need its result.
- A local agent is looping or stalled and needs to be cut short.
- The user changed direction and background work for the previous direction should be abandoned.
- A remote session is about to time out or is holding a resource you need.
- You need a clean slate before starting a new run of the same task.

Prefer letting short-lived background work finish on its own. `TaskStop` is for cases where continued execution has no value or is actively harmful.

## Parameters

- `task_id` (string, required): The runtime handle returned when the background task was started. This is the same identifier accepted by `TaskOutput`, not a task-list `taskId`.

## Examples

### Example 1

Stop a runaway background shell command.

```
TaskStop(task_id: "bash_01HXYZ...")
```

The command receives a terminate signal; buffered output written so far remains readable at its output path.

### Example 2

Cancel a dispatched agent after a user course-correction.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Notes

- `TaskStop` requests termination; it does not guarantee instantaneous shutdown. Well-behaved tasks exit promptly, but a process doing blocking I/O may take a moment to unwind.
- Stopping a task does not delete its output. For background shell tasks, the output file on disk is preserved and still readable with `Read`. For agents and sessions, whatever output was captured before the stop is still accessible via `TaskOutput`.
- An unknown `task_id`, or a task that has already finished, returns an error or a no-op. This is safe — you can call `TaskStop` defensively without checking status first.
- If you intend to restart the same work, stop the old task before dispatching the new one to avoid two parallel runs racing on shared resources (files, ports, database rows).
- `TaskStop` does not affect entries in the team task list. To cancel a tracked task, update its status to `deleted` with `TaskUpdate`.
