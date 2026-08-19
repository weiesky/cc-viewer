# ExitWorktree

退出由 `EnterWorktree` 创建的 worktree 会话，并将会话返回到原始工作目录。此工具仅对当前会话中由 `EnterWorktree` 创建的 worktree 生效；如果没有活跃的此类会话，调用将为空操作。

## 何时使用

- 已完成隔离 worktree 中的工作，希望返回主工作目录。
- 在功能分支 worktree 中完成任务并合并后，需要清理该分支和目录。
- 希望保留 worktree 以便稍后继续使用，只需返回原始目录而不删除任何内容。
- 希望放弃实验性或临时性分支，不在磁盘上保留任何产物。
- 需要开启新的 `EnterWorktree` 会话，必须先退出当前会话。

## 参数

- `action`（字符串，必填）：`"keep"` 保留 worktree 目录和分支，以便之后返回；`"remove"` 删除 worktree 目录及其分支，执行干净退出。
- `discard_changes`（布尔值，可选，默认 `false`）：仅在 `action` 为 `"remove"` 时有意义。若 worktree 存在未提交的文件或不在原始分支上的提交，工具将拒绝删除，除非将 `discard_changes` 设置为 `true`。错误响应会列出具体变更，以便在重新调用前与用户确认。

## 示例

### 示例 1：合并变更后的干净退出

在 worktree 中完成工作并将分支合并到主分支后，使用 `action: "remove"` 调用 `ExitWorktree`，删除 worktree 目录和分支，并返回原始工作目录。

```
ExitWorktree(action: "remove")
```

### 示例 2：丢弃含有未提交实验代码的临时 worktree

若 worktree 包含需要完全丢弃的实验性未提交变更，先尝试 `action: "remove"`。工具将拒绝并列出未提交的变更。在与用户确认可以丢弃后，再次调用并传入 `discard_changes: true`。

```
ExitWorktree(action: "remove", discard_changes: true)
```

## 注意事项

- 此工具仅对当前会话中由 `EnterWorktree` 创建的 worktree 生效。它不会影响通过 `git worktree add` 创建的 worktree、之前会话的 worktree，或从未调用过 `EnterWorktree` 时的普通工作目录——这些情况下调用为空操作。
- 若 worktree 存在未提交的变更或未合入原始分支的提交，`action: "remove"` 将拒绝执行，除非明确提供 `discard_changes: true`。设置此参数前务必与用户确认，因为数据一旦删除无法恢复。
- 若 worktree 附有 tmux 会话：`remove` 时该会话会被终止；`keep` 时会话继续运行，并返回其名称以便用户之后重新连接。
- `ExitWorktree` 完成后，可再次调用 `EnterWorktree` 开始新的 worktree 会话。
