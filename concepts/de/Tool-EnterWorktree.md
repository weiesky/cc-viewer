# EnterWorktree

## Definition

Creates an isolated git worktree and switches the current session into it. Only used when the user explicitly asks to work in a worktree.

## Parameter

| Name | Type | Required | Description |
|---|---|---|---|
| name | string | No | A name for the worktree. If not provided, a random name is generated. |

## Anwendungsfälle

**Geeignet für:**
- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree")

**Nicht geeignet für:**
- The user asks to create/switch branches — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees

## Hinweise

- Must be in a git repository, or have WorktreeCreate/WorktreeRemove hooks configured
- Must not already be in a worktree

## Bedeutung in cc-viewer

EnterWorktree calls appear in request logs as `tool_use` content blocks. It creates an isolated working environment, and subsequent file operations occur within the worktree directory.

## Originaltext

<textarea readonly>Use this tool ONLY when the user explicitly asks to work in a worktree. This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless they specifically mention worktrees
- Never use this tool unless the user explicitly mentions "worktree"

## Requirements

- Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json
- Must not already be in a worktree

## Behavior

- In a git repository: creates a new git worktree inside `.claude/worktrees/` with a new branch based on HEAD
- Outside a git repository: delegates to WorktreeCreate/WorktreeRemove hooks for VCS-agnostic isolation
- Switches the session's working directory to the new worktree
- On session exit, the user will be prompted to keep or remove the worktree

## Parameters

- `name` (optional): A name for the worktree. If not provided, a random name is generated.
</textarea>
