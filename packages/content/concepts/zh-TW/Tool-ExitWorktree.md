# ExitWorktree

退出由 `EnterWorktree` 建立的 worktree 工作階段，並將工作階段返回到原始工作目錄。此工具僅對當前工作階段中由 `EnterWorktree` 建立的 worktree 生效；若沒有活躍的此類工作階段，呼叫將為空操作。

## 使用時機

- 已完成隔離 worktree 中的工作，希望返回主工作目錄。
- 在功能分支 worktree 中完成任務並合併後，需要清理該分支和目錄。
- 希望保留 worktree 以便稍後繼續使用，只需返回原始目錄而不刪除任何內容。
- 希望放棄實驗性或臨時性分支，不在磁碟上保留任何產物。
- 需要開啟新的 `EnterWorktree` 工作階段，必須先退出當前工作階段。

## 參數

- `action`（字串，必填）：`"keep"` 保留 worktree 目錄和分支，以便之後返回；`"remove"` 刪除 worktree 目錄及其分支，執行乾淨退出。
- `discard_changes`（布林值，選填，預設 `false`）：僅在 `action` 為 `"remove"` 時有意義。若 worktree 存在未提交的檔案或不在原始分支上的提交，工具將拒絕刪除，除非將 `discard_changes` 設定為 `true`。錯誤回應會列出具體變更，以便在重新呼叫前與使用者確認。

## 範例

### 範例 1：合併變更後的乾淨退出

在 worktree 中完成工作並將分支合併到主分支後，使用 `action: "remove"` 呼叫 `ExitWorktree`，刪除 worktree 目錄和分支，並返回原始工作目錄。

```
ExitWorktree(action: "remove")
```

### 範例 2：丟棄含有未提交實驗程式碼的臨時 worktree

若 worktree 包含需要完全丟棄的實驗性未提交變更，先嘗試 `action: "remove"`。工具將拒絕並列出未提交的變更。在與使用者確認可以丟棄後，再次呼叫並傳入 `discard_changes: true`。

```
ExitWorktree(action: "remove", discard_changes: true)
```

## 注意事項

- 此工具僅對當前工作階段中由 `EnterWorktree` 建立的 worktree 生效。它不會影響透過 `git worktree add` 建立的 worktree、先前工作階段的 worktree，或從未呼叫過 `EnterWorktree` 時的普通工作目錄——這些情況下呼叫為空操作。
- 若 worktree 存在未提交的變更或未合入原始分支的提交，`action: "remove"` 將拒絕執行，除非明確提供 `discard_changes: true`。設定此參數前務必與使用者確認，因為資料一旦刪除無法恢復。
- 若 worktree 附有 tmux 工作階段：`remove` 時該工作階段會被終止；`keep` 時工作階段繼續運行，並返回其名稱以便使用者之後重新連線。
- `ExitWorktree` 完成後，可再次呼叫 `EnterWorktree` 開始新的 worktree 工作階段。
