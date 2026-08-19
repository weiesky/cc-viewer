# EnterWorktree

Creates an isolated Git worktree on a new branch, or switches the session into an existing worktree of the current repository, so that parallel or experimental work can proceed without touching the primary checkout.

## When to Use

- The user explicitly says "worktree" — for example "start a worktree", "create a worktree", or "work in a worktree".
- Project instructions in `CLAUDE.md` or persistent memory direct you to use a worktree for the current task.
- You want to continue a task that was previously set up as a worktree (pass `path` to re-enter it).
- Multiple experimental branches need to coexist on disk without constant checkout churn.
- A long-running task should be insulated from unrelated edits in the main working tree.

## Parameters

- `name` (string, optional): A name for a new worktree directory. Each `/`-separated segment may contain only letters, digits, dots, underscores, and dashes; the full string is capped at 64 characters. If omitted and `path` is also omitted, a random name is generated. Mutually exclusive with `path`.
- `path` (string, optional): The filesystem path of an existing worktree of the current repository to switch into. Must appear in `git worktree list` for this repo; paths that are not registered worktrees of the current repo are rejected. Mutually exclusive with `name`.

## Examples

### Example 1: Create a new worktree with a descriptive name

```
EnterWorktree(name="feat/okta-sso")
```

Creates `.claude/worktrees/feat/okta-sso` on a new branch based on `HEAD`, then switches the session's working directory into it. All subsequent file edits and shell commands operate inside that worktree until you exit.

### Example 2: Re-enter an existing worktree

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Resumes work in a previously created worktree. Because you entered it via `path`, `ExitWorktree` will not delete it automatically — leaving with `action: "keep"` simply returns to the original directory.

## Notes

- Do not call `EnterWorktree` unless the user has explicitly asked or project instructions require it. Ordinary branch-switching or bug-fix requests should use normal Git commands, not worktrees.
- When invoked inside a Git repository, the tool creates a worktree under `.claude/worktrees/` and registers a new branch based on `HEAD`. Outside a Git repository, it delegates to configured `WorktreeCreate` / `WorktreeRemove` hooks in `settings.json` for VCS-agnostic isolation.
- Only one worktree session is active at a time. The tool refuses to run if you are already inside a worktree session; exit first with `ExitWorktree`.
- Use `ExitWorktree` to leave mid-session. If the session ends while still inside a newly created worktree, the user is prompted to keep or remove it.
- Worktrees entered by `path` are considered external — `ExitWorktree` with `action: "remove"` will not delete them. This is a safety rail to protect worktrees the user manages manually.
- A new worktree inherits the current branch's contents but has an independent working directory and index. Staged and unstaged changes in the main checkout are not visible inside the worktree.
- Naming tip: prefix with the kind of work (`feat/`, `fix/`, `spike/`) so multiple concurrent worktrees are easy to distinguish in `git worktree list`.
