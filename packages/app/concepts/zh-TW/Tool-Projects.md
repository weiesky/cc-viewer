# Projects

管理使用者 Claude 專案知識庫中的專案文件：讀取、搜尋、寫入與刪除文件，或取得專案資訊。

## 使用時機

- 將一份文件（交付物、筆記、參考資料）持久化到使用者的專案中，讓它在工作階段之後仍然存在。
- 讀取或搜尋現有專案文件，讓目前任務奠基於先前的脈絡。
- 將本地檔案上傳到專案中，而不將其內容載入上下文。
- 移除過時的專案文件。

## 參數

- `method`（string，必填）：`project_info`、`project_read`、`project_search`、`project_write`、`project_delete` 其中之一。
- `path`（string，選填）：用於 `project_read`/`project_write`/`project_delete`：文件路徑。用於 `project_write`：現有路徑會被就地取代；新的裸檔名（不含 "/"）會加上命名空間 `claude/<name>`。
- `content`（string，選填）：用於 `project_write`：內聯文件文字。與 `local_path` 互斥。
- `local_path`（string，選填）：用於 `project_write`：工作目錄中要上傳的檔案——其內容絕不會進入你的上下文。與 `content` 互斥。
- `present_to_user`（boolean，選填）：用於 `project_write`：將此文件標記為使用者需要看到的交付物。預設 false；例行儲存與批次寫入時保持未設定。
- `query`（string，選填）：用於 `project_search`：知識庫查詢。
- `n`（number，選填）：用於 `project_search`：命中數量（預設 5）。

## 範例

### 範例 1：將交付物寫入專案

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

上傳本地檔案而不將其內容拉入上下文，並將它標記為使用者的交付物。

### 範例 2：搜尋知識庫

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## 注意事項

- `content` 用於你內聯撰寫的文字；`local_path` 用於任何已在磁碟上的內容——絕不要混用兩者。
- 謹慎使用 `present_to_user=true`：僅用於使用者要求或必須採取行動的那一份文件。
