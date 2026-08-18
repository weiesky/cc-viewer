# SendMessage

Delivers a message from one team member to another within an active team, or broadcasts to every teammate at once. This is the only channel teammates can hear — anything written to normal text output is invisible to them.

## When to Use

- Assigning a task or handing off a subproblem to a named teammate during team collaboration.
- Requesting status, intermediate findings, or a code review from another agent.
- Broadcasting a decision, shared constraint, or shutdown announcement to the full team via `*`.
- Replying to a protocol prompt such as a shutdown request or a plan-approval request from the team leader.
- Closing the loop at the end of a delegated task so the leader can mark the item complete.

## Activation

- Gated by the same cross-session messaging conditions as `ListAgents` (server-side feature flags, off by default).
- Teammates additionally require experimental agent teams to be enabled.

## Parameters

- `to` (string, required): The target teammate's `name` as registered in the team, or `*` to broadcast to all teammates at once.
- `message` (string or object, required): Plain text for normal communication, or a structured object for protocol responses like `shutdown_response` and `plan_approval_response`.
- `summary` (string, optional): A 5–10 word preview shown in the team activity log for plain-text messages. Required for long string messages; ignored when `message` is a protocol object.

## Examples

### Example 1: Direct task handoff

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Example 2: Broadcast a shared constraint

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Example 3: Protocol response

Respond to a shutdown request from the leader using a structured message:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Example 4: Plan approval response

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Notes

- Your regular assistant text output is NOT transmitted to teammates. If you want another agent to see something, it must go through `SendMessage`. This is the single most common mistake in team workflows.
- Broadcast (`to: "*"`) is expensive — it wakes every teammate and consumes their context. Reserve it for announcements that genuinely affect everyone. Prefer targeted sends.
- Keep messages concise and action-oriented. Include the file paths, constraints, and expected reply format the recipient needs; remember they have no shared memory with you.
- Protocol message objects (`shutdown_response`, `plan_approval_response`) have fixed shapes. Do not mix protocol fields into plain-text messages or vice versa.
- Messages are asynchronous. The recipient will receive yours on their next turn; do not assume they have read or acted on it until they reply.
- A well-written `summary` makes the team activity log scannable for the leader — treat it like a commit subject line.
