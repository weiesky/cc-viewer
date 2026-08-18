# SendFile

Sends one or more files to another Claude Code session — a peer listed by `ListAgents`, or an explicit session address.

## When to Use

- A peer session needs a file from your working directory (a report, a patch, a fixture) to continue its own task.
- You are coordinating work across sessions and want to hand off artifacts, not just text (use `SendMessage` for text).

## Activation

- Cross-session file transfer must be available in the session; when it is not, validation fails with "Cross-session file transfer is not available in this session."
- Gated by the same cross-session messaging conditions as `ListAgents` (server-side feature flags, off by default).

## Parameters

- `to` (string, required): Recipient — a peer session name from `ListAgents`, or an explicit `uds:<socket>` / `bridge:<session id>` address.
- `files` (array of strings, required): File paths (absolute or relative to cwd) to send. Always pass an array, even for a single file. 1–16 files, at most 30 MiB each.
- `message` (string, optional): Short message delivered alongside the files.

## Examples

### Example 1: Send a report to a peer session

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Notes

- Transfers to remote machines may require additional approval.
- Reading the file contents is part of the send — denied if file reads are disabled by permission rules.
