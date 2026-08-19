# Bash

Runs a shell command inside a persistent working directory and returns its stdout/stderr. Best reserved for operations that no dedicated Claude Code tool can express, such as running git, npm, docker, or build scripts.

## When to Use

- Executing git operations (`git status`, `git diff`, `git commit`, `gh pr create`)
- Running package managers and build tools (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Launching long-running processes (dev servers, watchers) in the background with `run_in_background`
- Invoking domain-specific CLIs (`docker`, `terraform`, `kubectl`, `gh`) that have no built-in equivalent
- Chaining dependent steps together with `&&` when ordering matters

## Parameters

- `command` (string, required): The exact shell command to execute.
- `description` (string, required): A short, active-voice summary (5-10 words for simple commands; more context for piped or obscure ones).
- `timeout` (number, optional): Timeout in milliseconds, up to `600000` (10 minutes). Defaults to `120000` (2 minutes).
- `run_in_background` (boolean, optional): When `true`, the command runs detached and you receive a notification on completion. Do not append `&` yourself.

## Examples

### Example 1: Inspect repo state before committing
Issue `git status` and `git diff --stat` as two parallel `Bash` calls in the same message to gather context quickly, then assemble the commit in a follow-up call.

### Example 2: Chain dependent build steps
Use a single call such as `npm ci && npm run build && npm test` so each step only runs after the previous one succeeds. Use `;` only if you intentionally want later steps to run even after failures.

### Example 3: Long-running dev server
Invoke `npm run dev` with `run_in_background: true`. You will be notified when it exits. Do not poll with `sleep` loops; diagnose failures instead of retrying blindly.

## Notes

- The working directory persists between calls, but shell state (exported variables, shell functions, aliases) does not. Prefer absolute paths and avoid `cd` unless the user asks for it.
- Prefer dedicated tools over piped shell equivalents: `Glob` instead of `find`/`ls`, `Grep` instead of `grep`/`rg`, `Read` instead of `cat`/`head`/`tail`, `Edit` instead of `sed`/`awk`, `Write` instead of `echo >` or heredocs, and plain assistant text instead of `echo`/`printf` for user-facing output.
- Quote any path that contains spaces with double quotes (for example `"/Users/me/My Project/file.txt"`).
- For independent commands, make multiple `Bash` tool calls in parallel within a single message. Only chain with `&&` when one command depends on another.
- Output over 30000 characters is truncated. When capturing large logs, redirect to a file and then read it with the `Read` tool.
- Never use interactive flags such as `git rebase -i` or `git add -i`; they cannot receive input through this tool.
- Do not skip git hooks (`--no-verify`, `--no-gpg-sign`) or perform destructive operations (`reset --hard`, `push --force`, `clean -f`) unless the user explicitly requests them.
