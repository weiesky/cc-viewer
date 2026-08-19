# SubAgent: Search

## Purpose

The Search subagent is a lightweight, read-only exploration agent. Dispatch it when you need to understand a codebase — find where something lives, learn how components fit together, or answer structural questions — without changing any files. It is optimised for many small reads across many files, returning a concise summary rather than raw search output.

Search is not a general-purpose assistant. It cannot edit code, run builds, commit changes, or open network connections beyond read-only fetches. Its value is that it can burn through a large exploration budget in parallel without consuming the main agent's context, then hand back a compact answer.

## When to Use

- You need to answer a question that requires three or more distinct searches or reads. Example: "How is authentication wired from the login route down to the session store?"
- The target is unknown — you do not yet know which file, module, or symbol to look at.
- You need a structural overview of an unfamiliar area of the repo before making changes.
- You want to cross-reference multiple candidates (for example, which of several similarly-named helpers is actually called in production).
- You need a literature-style summary: "list every place that imports X and categorise by call site."

Do not use Search when:

- You already know the exact file and line. Call `Read` directly.
- A single `Grep` or `Glob` will answer the question. Run it directly; dispatching a subagent adds overhead.
- The task requires editing, running commands, or any side effect. Search is read-only by design.
- You need exact verbatim output of a tool call. Subagents summarise; they do not proxy raw results.

## Thoroughness Levels

Pick the level that matches the stakes of the question.

- `quick` — a few targeted searches, best-effort answer. Use when you need a fast pointer (for example, "where is the env-var parsing logic?") and are comfortable iterating if the answer is incomplete.
- `medium` — the default. Several rounds of search, cross-checking candidates, and reading the most relevant files in full. Use for typical "help me understand this area" questions.
- `very thorough` — exhaustive exploration. The subagent will chase every plausible lead, read surrounding context, and double-check findings before summarising. Use when correctness matters (for example, security review, migration planning) or when an incomplete answer will cause rework.

Higher thoroughness costs more time and tokens inside the subagent, but those tokens stay inside the subagent — only the final summary returns to the main agent.

## Tools Available

Search has access to all read-only tools the main agent uses, and nothing else:

- `Read` — for reading specific files, including partial ranges.
- `Grep` — for content searches across the tree.
- `Glob` — for locating files by name pattern.
- `Bash` in read-only mode — for commands that inspect state without mutating it (for example `git log`, `git show`, `ls`, `wc`).
- `WebFetch` and `WebSearch` — for reading external documentation when that context is required.

Edit tools (`Write`, `Edit`, `NotebookEdit`), shell commands that modify state, and task-graph tools (`TaskCreate`, `TaskUpdate`, and so on) are deliberately unavailable.

## Notes

- Give the Search subagent a specific question, not a topic. "List every caller of `renderMessage` and note which ones pass a custom theme" returns a useful answer; "tell me about rendering" does not.
- The subagent returns a summary. If you need exact file paths, ask for them explicitly in your prompt.
- Multiple independent questions are best dispatched as parallel Search subagents rather than one long prompt, so each can focus.
- Because Search cannot edit, pair it with a follow-up edit step in the main agent once you know what to change.
- Treat Search output as evidence, not ground truth. For anything load-bearing, open the cited files yourself before acting.
