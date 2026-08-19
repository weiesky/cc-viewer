# SendFeedback

Sends structured feedback about Claude Code to Anthropic — bug reports, feature ideas, or missing capabilities — without leaving the session.

## When to Use

- The user asks to report a bug or send feedback about Claude Code itself.
- You hit a clear product defect (broken command, wrong behavior, crash) worth reporting.
- The user describes a feature they wish existed (an idea or missing capability).

## Parameters

- `type` (string, required): One of `bug`, `idea`, `missing_capability`.
- `title` (string, required): Short, specific one-line summary of the issue.
- `details` (string, required): Labeled bullets, in order: **What happened:** (observed vs. expected, exact error text if short); **What the user said:** (quoted, or "User didn't comment; observed by the model."); **Repro:** (minimal steps); **Evidence:** (request IDs, timestamps, paths, versions — omit if none); optionally a final **Cause:** only if verified in-session. One to three lines per bullet; no narrative paragraphs, no speculation, no secrets.
- `area` (string, optional): Short tag naming the part of Claude Code this is about (e.g. "hooks config", "/help", "file editing"). Leave blank if unclear.
- `failure_mode` (string, optional): For model-behavior reports, the closest failure mode (e.g. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short`, or `other`). Omit only when the report is a pure product/tool bug.
- `task_category` (string, optional): What the session was doing when the issue occurred: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review`, or `other`.

## Examples

### Example 1: Report a product bug

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Notes

- Never include secrets, tokens, or private user data in `details`.
- Quote the user's words when available; otherwise state that the model observed the issue.
- Keep the report factual — speculation about root cause belongs in `**Cause:**` only when verified in-session.
