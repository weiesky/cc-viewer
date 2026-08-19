# EnterWorktree

在新的分支上建立一個隔離的 Git worktree，或將工作階段切換到目前 repo 的既有 worktree，讓平行或實驗性質的工作可以進行而不影響主要 checkout。

## 使用時機

- 使用者明確表示「worktree」——例如「start a worktree」、「create a worktree」或「work in a worktree」。
- `CLAUDE.md` 或持久記憶中的專案指示要求你為目前任務使用 worktree。
- 你想繼續之前已設置為 worktree 的任務（透過 `path` 重新進入）。
- 需要多個實驗性分支同時存在於磁碟上，避免頻繁切換 checkout。
- 長時間執行的任務需要與主工作樹中的其他無關編輯隔離。

## 參數

- `name`（string，選填）：新 worktree 目錄的名稱。每個以 `/` 分隔的區段只能包含字母、數字、點、底線與破折號；完整字串上限 64 個字元。若未提供且也未提供 `path`，會產生隨機名稱。與 `path` 互斥。
- `path`（string，選填）：要切入的目前 repo 既有 worktree 的檔案系統路徑。必須出現在該 repo 的 `git worktree list` 中；若路徑不是目前 repo 註冊的 worktree 則會被拒絕。與 `name` 互斥。

## 範例

### 範例 1：以描述性名稱建立新 worktree

```
EnterWorktree(name="feat/okta-sso")
```

以 `HEAD` 為基礎，在新分支上建立 `.claude/worktrees/feat/okta-sso`，並將工作階段的工作目錄切換進去。在你退出之前，後續的檔案編輯與 shell 指令都在該 worktree 內執行。

### 範例 2：重新進入既有 worktree

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

回到先前建立的 worktree 繼續工作。由於你是透過 `path` 進入，`ExitWorktree` 不會自動刪除它——以 `action: "keep"` 離開，只會回到原來的目錄。

## 注意事項

- 除非使用者明確提出或專案指示要求，否則不要呼叫 `EnterWorktree`。一般的切換分支或修 bug 請求應使用一般 Git 指令，而非 worktree。
- 在 Git repo 內呼叫時，工具會在 `.claude/worktrees/` 底下建立一個 worktree，並以 `HEAD` 為基礎註冊新分支。在非 Git repo 中，則委派給 `settings.json` 中設定的 `WorktreeCreate` / `WorktreeRemove` hooks，以進行不依賴 VCS 的隔離。
- 同一時間只能啟用一個 worktree session。若你已在 worktree session 中，工具會拒絕執行；請先用 `ExitWorktree` 退出。
- 使用 `ExitWorktree` 在 session 進行中退出。若 session 結束時仍在新建立的 worktree 內，會提示使用者保留或移除。
- 透過 `path` 進入的 worktree 被視為外部——以 `action: "remove"` 呼叫 `ExitWorktree` 不會刪除它們。這是保護使用者手動管理之 worktree 的安全機制。
- 新 worktree 繼承目前分支的內容，但擁有獨立的工作目錄與索引。主 checkout 中已暫存或未暫存的變更在 worktree 內看不到。
- 命名建議：加上工作種類前綴（`feat/`、`fix/`、`spike/`），以便在 `git worktree list` 中輕鬆區分多個並行 worktree。
