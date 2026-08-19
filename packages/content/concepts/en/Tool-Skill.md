# Skill

Invokes a named skill inside the current conversation. Skills are pre-packaged capability bundles — domain knowledge, workflows, and sometimes tool access — that the harness exposes to the assistant through system reminders.

## When to Use

- The user types a slash command such as `/review` or `/init` — slash commands are skills and must be executed through this tool.
- The user describes a task that matches an advertised skill's trigger conditions (for example, asking to scan transcripts for repeated permission prompts matches `fewer-permission-prompts`).
- A skill's stated purpose is a direct match for the current file, request, or conversation context.
- Specialized, repeatable workflows are available as skills and the canonical procedure is preferable to an ad-hoc approach.
- The user asks "what skills are available" — list the advertised names, and invoke only when they confirm.

## Parameters

- `skill` (string, required): The exact name of a skill listed in the current available-skills system reminder. For plugin-namespaced skills, use the fully qualified `plugin:skill` form (for example `skill-creator:skill-creator`). Do not include a leading slash.
- `args` (string, optional): Free-form arguments passed to the skill. Format and semantics are defined by each skill's own documentation.

## Examples

### Example 1: Run a review skill on the current branch

```
Skill(skill="review")
```

The `review` skill packages the steps for reviewing a pull request against the current base branch. Invoking it loads the harness-defined review procedure into the turn.

### Example 2: Invoke a plugin-namespaced skill with arguments

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Routes the request through the `skill-creator` plugin's entry point so the authoring workflow kicks in.

## Notes

- Only invoke skills whose names appear verbatim in the available-skills system reminder, or skills the user typed directly as `/name` in their message. Never guess or invent skill names from memory or training data — if the skill is not advertised, do not call this tool.
- When a user's request matches an advertised skill, calling `Skill` is a blocking prerequisite: invoke it before generating any other response about the task. Do not describe what the skill would do — run it.
- Never mention a skill by name without actually invoking it. Announcing a skill without calling the tool is misleading.
- Do not use `Skill` for built-in CLI commands such as `/help`, `/clear`, `/model`, or `/exit`. Those are handled by the harness directly.
- Do not re-invoke a skill that is already running in the current turn. If you see a `<command-name>` tag in the current turn, the skill has already been loaded — follow its instructions in place instead of calling the tool again.
- If several skills could apply, choose the most specific one. For configuration changes such as adding permissions or hooks, prefer `update-config` over a generic settings approach.
- Skill execution can introduce new system reminders, tools, or constraints for the remainder of the turn. Re-read the conversation state after a skill completes before proceeding.
