# NotebookEdit

修改 Jupyter notebook（`.ipynb`）中的單一 cell。支援取代 cell 原始碼、插入新 cell 或刪除既有 cell，同時保留 notebook 其餘結構。

## 使用時機

- 修正或更新分析 notebook 中的某個 code cell，而不重寫整個檔案
- 替換某個 markdown cell 以改善敘事或新增說明
- 在既有 notebook 中的已知位置插入新的 code 或 markdown cell
- 移除已過時或損壞的 cell，使下游 cell 不再依賴它
- 透過一次一個 cell 的迭代來準備可重現的 notebook

## 參數

- `notebook_path`（string，必填）：`.ipynb` 檔案的絕對路徑。相對路徑會被拒絕。
- `new_source`（string，必填）：新的 cell 原始碼。對 `replace` 與 `insert` 來說會成為 cell 內容；對 `delete` 會被忽略，但 schema 仍要求提供。
- `cell_id`（string，選填）：目標 cell 的 ID。在 `replace` 與 `delete` 模式下，工具作用於此 cell。在 `insert` 模式下，新 cell 會插入於此 ID 的 cell 之後；省略則插入到 notebook 最上方。
- `cell_type`（enum，選填）：`code` 或 `markdown`。`edit_mode` 為 `insert` 時必填。在 `replace` 時省略則保留既有 cell 的類型。
- `edit_mode`（enum，選填）：`replace`（預設）、`insert` 或 `delete`。

## 範例

### 範例 1：替換有 bug 的 code cell
呼叫 `NotebookEdit`，將 `notebook_path` 設為絕對路徑、`cell_id` 設為目標 cell 的 ID，並以修正後的 Python 程式碼填入 `new_source`。`edit_mode` 保留預設的 `replace`。

### 範例 2：插入 markdown 說明
要在既有 `setup` cell 之後新增一個 markdown cell，設 `edit_mode: "insert"`、`cell_type: "markdown"`、`cell_id` 為 setup cell 的 ID，並把敘事放在 `new_source`。

### 範例 3：刪除過期的 cell
設 `edit_mode: "delete"` 並提供要移除之 cell 的 `cell_id`。`new_source` 隨便給一個字串即可；它不會被套用。

## 注意事項

- 一律傳入絕對路徑。`NotebookEdit` 不會依工作目錄解析相對路徑。
- 工具只會改寫目標 cell；其他不相關 cell 的執行計數、輸出與 metadata 保持不動。
- 插入時未指定 `cell_id`，新 cell 會被放到 notebook 最前面。
- `cell_type` 在插入時為必填。在替換時若不打算把 code cell 改成 markdown（或反之），就省略此參數。
- 要檢視 cell 並取得其 ID，請先以 `Read` 工具讀取 notebook；它會回傳含內容與輸出的 cells。
- 一般原始檔請使用 `Edit`；`NotebookEdit` 專屬於 `.ipynb` JSON 並理解其 cell 結構。
