# ProposeGoal

Proposes a verifiable completion goal for the session. The goal is shown to the user in an approval dialog (by default) and, once set, guides the rest of the conversation toward a checkable outcome.

## When to Use

- The session has a concrete end state that an evaluator could verify from the conversation (e.g. "all tests in test/auth pass").
- You want the user's explicit sign-off on what "done" means before doing substantial work.
- The user's own words already stated the outcome and you want it recorded as the session goal.

## Activation

- Off by default (server-side feature flag).
- Excluded from interactive and background sessions.
- Turned off by the `modelProposedGoals: "disabled"` settings key.

## Parameters

- `condition` (string, required): The completion condition, written so a separate evaluator can verify it from the conversation (e.g. "all tests in test/auth pass (bun test exits 0)"). At most 500 characters — the user must be able to read the whole condition in the approval dialog.
- `ask_user` (boolean, optional): Whether to ask the user for approval before the goal is set. Defaults to true (an approval dialog is shown). Set false ONLY when the user's own words in this conversation stated this outcome as what they want; the goal is then set directly with a visible notice, and the user can clear it with `/goal clear`.

## Examples

### Example 1: Propose a test-backed goal

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

The user sees the condition in an approval dialog and can accept, edit, or reject it.

### Example 2: Adopt the user's stated outcome directly

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Only valid because the user explicitly stated that outcome earlier in the conversation.

## Notes

- Keep `condition` short and objectively checkable — vague goals ("make it better") defeat the purpose.
- `ask_user=false` is strictly limited to outcomes the user themselves stated; anything else must go through the approval dialog.
