# EnterWorktree

## 定義

隔離された git worktree を作成し、現在のセッションをその中に切り替えます。ユーザーが明示的に worktree での作業を要求した場合にのみ使用します。

## パラメータ

| パラメータ名 | 型 | 必須 | 説明 |
|---|---|---|---|
| name | string | 否 | `name`（任意）：worktree の名前。指定しない場合はランダムな名前が生成されます。 |

## 使用場面

**適している場面：**
- ユーザーが明示的に「worktree」と言った場合（例：「worktree を作成して」「worktree で作業して」）

**適さない場面：**
- ユーザーがブランチの作成・切り替えを要求——git コマンドを使用
- ユーザーがバグ修正や機能開発を要求——worktree を明示しない限り通常の git ワークフローを使用

## 注意事項

- git リポジトリ内であるか、WorktreeCreate/WorktreeRemove hooks が設定されている必要がある
- 既に worktree 内にいてはならない

## cc-viewer での意義

EnterWorktree の呼び出しはリクエストログに `tool_use` content block として表示されます。隔離された作業環境を作成し、以降のファイル操作は worktree ディレクトリ内で行われます。

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
