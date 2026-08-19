# ExitWorktree

Exit a worktree session previously created by `EnterWorktree` and return the session to the original working directory. This tool only operates on worktrees created by `EnterWorktree` in the current session; it is a no-op if no such session is active.

## When to Use

- You have finished work in an isolated worktree and want to return to the main working directory.
- You completed a task in a feature branch worktree and want to clean up the branch and directory after merging.
- You want to preserve the worktree for later and simply return to the original directory without deleting anything.
- You want to abandon an experimental or throwaway branch without keeping any of its artifacts on disk.
- You need to start fresh with a new `EnterWorktree` call, which requires exiting the current one first.

## Parameters

- `action` (string, required): `"keep"` leaves the worktree directory and branch intact on disk so you can return to them later; `"remove"` deletes both the worktree directory and its branch, performing a clean exit.
- `discard_changes` (boolean, optional, default `false`): Only meaningful when `action` is `"remove"`. If the worktree contains uncommitted files or commits that are not on the original branch, the tool refuses to remove it unless `discard_changes` is set to `true`. The error response lists the specific changes so you can confirm with the user before re-invoking.

## Examples

### Example 1: clean exit after merging changes

After finishing work in a worktree and merging the branch into main, call `ExitWorktree` with `action: "remove"` to delete the worktree directory and branch, and return to the original working directory.

```
ExitWorktree(action: "remove")
```

### Example 2: discard a throwaway worktree with uncommitted experimental code

If a worktree contains experimental uncommitted changes that should be discarded entirely, first attempt `action: "remove"`. The tool will refuse and list the uncommitted changes. After confirming with the user that the changes can be discarded, re-invoke with `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Notes

- This tool only operates on worktrees created by `EnterWorktree` within the current session. It will not affect worktrees created with `git worktree add`, worktrees from previous sessions, or the plain working directory if `EnterWorktree` was never called — in those cases the tool is a no-op.
- `action: "remove"` refuses to proceed if the worktree has uncommitted changes or commits not present on the original branch, unless `discard_changes: true` is explicitly provided. Always confirm with the user before setting `discard_changes: true`, as the data cannot be recovered.
- If a tmux session was attached to the worktree: on `remove` it is killed; on `keep` it is left running, and its name is returned so the user can reattach later.
- After `ExitWorktree` completes, `EnterWorktree` can be called again to start a fresh worktree session.
