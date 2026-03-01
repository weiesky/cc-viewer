# NotebookEdit

## 定義

替換、插入或刪除 Jupyter notebook（.ipynb 檔案）中的特定儲存格。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `notebook_path` | string | 是 | notebook 檔案的絕對路徑 |
| `new_source` | string | 是 | 儲存格的新內容 |
| `cell_id` | string | 否 | 要編輯的儲存格 ID。插入模式下新儲存格插入到此 ID 之後 |
| `cell_type` | enum | 否 | 儲存格類型：`code` 或 `markdown`。插入模式下必填 |
| `edit_mode` | enum | 否 | 編輯模式：`replace`（預設）、`insert`、`delete` |

## 使用場景

**適合使用：**
- 修改 Jupyter notebook 中的程式碼或 markdown 儲存格
- 向 notebook 新增儲存格
- 刪除 notebook 中的儲存格

## 注意事項

- `cell_number` 是 0 索引的
- `insert` 模式在指定位置插入新儲存格
- `delete` 模式刪除指定位置的儲存格
- 路徑必須是絕對路徑

## 在 cc-viewer 中的意義

NotebookEdit 呼叫在請求日誌中表現為 `tool_use` content block，記錄了對 notebook 的具體修改操作。

## 原文

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
