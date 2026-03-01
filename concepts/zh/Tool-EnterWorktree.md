# EnterWorktree

## 定义

创建隔离的 git worktree 并将当前会话切换到其中。仅在用户明确要求使用 worktree 时使用。

## 参数

| 参数名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| name | string | 否 | `name`（可选）：worktree 的名称。未提供时自动生成随机名称。 |

## 使用场景

**适合使用：**
- 用户明确说 "worktree"（如 "创建一个 worktree"、"在 worktree 中工作"）

**不适合使用：**
- 用户要求创建分支、切换分支——使用 git 命令
- 用户要求修复 bug 或开发功能——除非明确提到 worktree，否则使用正常 git 工作流

## 注意事项

- 必须在 git 仓库中，或已配置 WorktreeCreate/WorktreeRemove hooks
- 不能已经在 worktree 中

## 在 cc-viewer 中的意义

EnterWorktree 调用在请求日志中表现为 `tool_use` content block。它创建隔离的工作环境，后续的文件操作都在 worktree 目录中进行。

## 原文

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
