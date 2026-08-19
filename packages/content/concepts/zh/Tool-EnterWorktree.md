# EnterWorktree

在新分支上创建一个隔离的 Git worktree，或将会话切换到当前仓库的已有 worktree，以便并行或试验性工作可在不影响主检出的情况下进行。

## 何时使用

- 用户明确说「worktree」——例如「开启一个 worktree」「创建一个 worktree」或「在 worktree 中工作」。
- `CLAUDE.md` 或持久内存中的项目指令要求你为当前任务使用 worktree。
- 你想继续之前以 worktree 形式建立的任务（传入 `path` 重新进入）。
- 多个试验性分支需要同时存在于磁盘上，而不必频繁切换检出。
- 长时间运行的任务需要与主工作树中的无关编辑隔离。

## 参数

- `name` (string, 可选)：新 worktree 目录的名称。每个以 `/` 分隔的段只能包含字母、数字、点、下划线和短横线；完整字符串上限 64 个字符。若 `name` 与 `path` 都省略，则自动生成随机名称。与 `path` 互斥。
- `path` (string, 可选)：要切换进入的当前仓库现有 worktree 的文件系统路径。必须出现在本仓库的 `git worktree list` 中；不属于当前仓库已注册 worktree 的路径会被拒绝。与 `name` 互斥。

## 示例

### 示例 1：使用描述性名称创建新 worktree

```
EnterWorktree(name="feat/okta-sso")
```

基于 `HEAD` 在新分支上创建 `.claude/worktrees/feat/okta-sso`，然后将会话的工作目录切换到其中。此后所有文件编辑和 shell 命令都在该 worktree 中执行，直到退出。

### 示例 2：重新进入已有的 worktree

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

恢复此前创建的 worktree 的工作。由于通过 `path` 进入，`ExitWorktree` 不会自动删除它——以 `action: "keep"` 离开只是返回原目录。

## 注意事项

- 除非用户明确要求或项目指令规定，否则不要调用 `EnterWorktree`。普通的分支切换或 bug 修复请求应使用标准 Git 命令，而不是 worktree。
- 在 Git 仓库内调用时，工具会在 `.claude/worktrees/` 下创建 worktree，并基于 `HEAD` 注册新分支。在 Git 仓库之外，它会委派给 `settings.json` 中配置的 `WorktreeCreate` / `WorktreeRemove` hook，以实现与 VCS 无关的隔离。
- 同一时间只允许一个 worktree 会话活跃。如果你已经在 worktree 会话中，本工具会拒绝运行；请先用 `ExitWorktree` 退出。
- 使用 `ExitWorktree` 在会话中途离开。若会话结束时仍处于新建的 worktree 内，系统会提示用户保留还是移除。
- 通过 `path` 进入的 worktree 被视为外部 worktree——带 `action: "remove"` 的 `ExitWorktree` 不会删除它们。这是保护用户手动管理的 worktree 的安全屏障。
- 新建的 worktree 继承当前分支的内容，但拥有独立的工作目录和索引。主检出中已暂存或未暂存的改动在 worktree 中不可见。
- 命名建议：以工作类型作前缀（`feat/`、`fix/`、`spike/`），让多个并发 worktree 在 `git worktree list` 中易于区分。
