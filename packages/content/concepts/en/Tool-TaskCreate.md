# TaskCreate

Creates a new task in the current team's task list (or the session's task list when no team is active). Use it to capture work items that should be tracked, delegated, or revisited later.

## When to Use

- The user describes a multi-step piece of work that benefits from explicit tracking.
- You are breaking a large request into smaller, separately-completable units.
- A follow-up is discovered mid-task and should not be forgotten.
- You need a durable record of intent before handing work to a teammate or subagent.
- You are operating in plan mode and want each plan step represented as a concrete task.

Skip `TaskCreate` for trivial one-shot actions, pure conversation, or anything completable in two or three direct tool calls.

## Activation

- Available by default on most models.
- Not available on Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 and later families (v2.1.233+) unless opted in via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools`, or `--tools`.
- The whole task system is disabled when `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parameters

- `subject` (string, required): Short imperative title, e.g. `Fix login redirect on Safari`. Keep it under roughly eighty characters.
- `description` (string, required): Detailed context — the problem, the constraints, acceptance criteria, and any files or links a future reader will need. Write as if a teammate will pick this up cold.
- `activeForm` (string, optional): Present-continuous spinner text shown while the task is `in_progress`, e.g. `Fixing login redirect on Safari`. Mirror the `subject` but in -ing form.
- `metadata` (object, optional): Arbitrary structured data attached to the task. Common uses: labels, priority hints, external ticket IDs, or agent-specific configuration.

Newly created tasks always start with status `pending` and no owner. Dependencies (`blocks`, `blockedBy`) are not set at creation time — apply them afterwards with `TaskUpdate`.

## Examples

### Example 1

Capture a bug report the user just filed.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Example 2

Split an epic into tracked units at the start of a session.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Notes

- Write the `subject` in the imperative voice and the `activeForm` in the present continuous so the UI reads naturally when the task transitions to `in_progress`.
- Call `TaskList` before creating to avoid duplicates — the team list is shared with teammates and subagents.
- Do not include secrets or credentials in `description` or `metadata`; task records are visible to anyone with access to the team.
- After creation, move the task through its lifecycle with `TaskUpdate`. Do not leave work silently abandoned in `in_progress`.
