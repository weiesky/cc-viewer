# Agent

Spawns an autonomous Claude Code subagent with its own context window to handle a focused task and return a single consolidated result. This is the canonical mechanism for delegating open-ended research, parallel work, or team collaboration.

## When to Use

- Open-ended searches where you do not yet know which files are relevant and expect multiple rounds of `Glob`, `Grep`, and `Read`.
- Parallel independent work — launch several agents in one message to investigate separate areas concurrently.
- Isolating noisy exploration from the main conversation so the parent context stays compact.
- Delegating to a specialized subagent type such as `Explore`, `Plan`, `claude-code-guide`, or `statusline-setup`.
- Spawning a named teammate into an active team for coordinated multi-agent work.

Do NOT use when the target file or symbol is already known — use `Read`, `Grep`, or `Glob` directly. A single-step lookup through `Agent` wastes a full context window and adds latency.

## Parameters

- `description` (string, required): Short 3–5 word label describing the task; shown in UI and logs.
- `prompt` (string, required): The complete, self-contained brief the agent will execute. Must include all necessary context, constraints, and the expected return format.
- `subagent_type` (string, optional): Preset persona such as `general-purpose`, `Explore`, `Plan`, `claude-code-guide`, or `statusline-setup`. Defaults to `general-purpose`.
- `run_in_background` (boolean, optional): If true, the agent runs asynchronously and the parent can continue working; results are retrieved later.
- `model` (string, optional): Override the model for this agent — `opus`, `sonnet`, or `haiku`. Defaults to the parent session model.
- `isolation` (string, optional): Set to `worktree` to run the agent inside an isolated git worktree so its filesystem writes do not collide with the parent.
- `team_name` (string, optional): When spawning into an existing team, the team identifier the agent will join.
- `name` (string, optional): Addressable teammate name within the team, used as the `to` target for `SendMessage`.

## Examples

### Example 1: Open-ended code search

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Example 2: Parallel independent investigations

Launch two agents in the same message — one inspecting the build pipeline, one reviewing the test harness. Each gets its own context window and returns a summary. Batching in a single tool-call block runs them concurrently.

### Example 3: Spawn a teammate into a running team

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Notes

- Agents have no memory of prior runs. Every invocation starts from zero, so the `prompt` must be fully self-contained — include file paths, conventions, the question, and the exact shape of the answer you want back.
- The agent returns exactly one final message. It cannot ask clarifying questions mid-run, so ambiguity in the prompt becomes guesswork in the result.
- Running multiple agents in parallel is significantly faster than sequential calls when the subtasks are independent. Batch them in a single tool-call block.
- Use `isolation: "worktree"` whenever an agent will write files and you want to review changes before merging into the main working tree.
- Prefer `subagent_type: "Explore"` for read-only reconnaissance and `Plan` for design work; `general-purpose` is the default for mixed read/write tasks.
- Background agents (`run_in_background: true`) suit long-running jobs; avoid polling in a sleep loop — the parent is notified on completion.
