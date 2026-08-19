# ExitPlanMode

Submits the implementation plan that was drafted during plan mode for user approval, and — if approved — transitions the session out of plan mode so that edits can begin.

## When to Use

- A plan written during `EnterPlanMode` is complete and ready for review.
- The task is implementation-focused (code or config changes), not pure research, so an explicit plan is appropriate.
- All prerequisite reading and analysis has been done; no further investigation is needed before the user decides.
- The assistant has enumerated concrete file paths, functions, and steps — not just goals.
- The user has asked to see the plan, or the plan-mode workflow is about to hand off to edit tools.

## Parameters

- `allowedPrompts` (array, optional): Prompts that the user may type on the approval screen to auto-approve or alter the plan. Each element specifies a scoped permission (for example, an operation name and the tool it applies to). Leave unset to use the default approval flow.

## Examples

### Example 1: Standard submission

After investigating an authentication refactor inside plan mode and writing the plan file to disk, the assistant calls `ExitPlanMode` with no arguments. The harness reads the plan from its canonical location, displays it to the user, and waits for approval or rejection.

### Example 2: Pre-approved quick actions

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Lets the user grant permission up front for routine follow-up commands, so the assistant does not need to pause for each permission prompt during implementation.

## Notes

- `ExitPlanMode` only makes sense for implementation-style work. If the user's request is a research or explanation task with no file changes, answer directly instead — do not route through plan mode just to exit it.
- The plan must already be written to disk before calling this tool. `ExitPlanMode` does not accept the plan body as a parameter; it reads from the path the harness expects.
- If the user rejects the plan, you return to plan mode. Revise based on the feedback and submit again; do not start editing files while the plan is unapproved.
- Approval grants permission to leave plan mode and use mutating tools (`Edit`, `Write`, `Bash`, and so on) for the scope described in the plan. Expanding scope afterwards requires a new plan or explicit user consent.
- Do not use `AskUserQuestion` to ask "does this plan look good?" before calling this tool — requesting plan approval is exactly what `ExitPlanMode` does, and the user cannot see the plan until it is submitted.
- Keep the plan minimal and actionable. A reviewer should be able to skim it in under a minute and understand exactly what will change.
- If you realize mid-implementation that the plan was wrong, stop and report back to the user rather than silently deviating. Re-entering plan mode is a valid next step.
