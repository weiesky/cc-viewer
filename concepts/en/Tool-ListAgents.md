# ListAgents

Lists the agents you can `SendMessage` to: in-process subagents you spawned, other local Claude sessions on this machine, your cloud sessions (when this session has cloud access), and — when Remote Control is connected — your account's other sessions. Each row is labeled by kind.

## When to Use

- You need the exact name of a peer session or subagent before sending it a message.
- You want to see which sessions are currently reachable from this one.

## Activation

- Requires Claude Code 2.1.224+ and cross-session messaging (a server-side feature flag, off by default).
- Cross-session messaging is unavailable on Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform, and Microsoft Foundry.
- Off when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, or `DISABLE_GROWTHBOOK` is set.
- Force-enable with `CLAUDE_CODE_HARBOR_KITE=1`.

## Parameters

- `channel` (string, optional): Not available in this build; leave unset.
- `q` (string, optional): Not available in this build; leave unset.

## Examples

### Example 1: List reachable agents

```
ListAgents()
```

Each row prints a name — that name is the address. Send with `SendMessage({to: "<name>", message: "..."})`, copying the name exactly as printed. Append a row's ` [ref]` only when the bare name is ambiguous (two rows share it, or an error asks you to disambiguate).

## Notes

- Read-only and concurrency-safe.
- A cloud session receives your message but cannot message back yet — read its answer in its own transcript.
