# Grep

使用 ripgrep 引擎搜尋檔案內容。支援完整的正規表示式、檔案類型過濾與三種輸出模式，讓你在精確度與精簡度之間取捨。

## 使用時機

- 定位某個函式的每個呼叫點，或某個識別字的每個參照
- 檢查某個字串或錯誤訊息是否出現在程式碼庫的任何地方
- 統計某個模式的出現次數，以評估重構前的影響範圍
- 以檔案類型（`type: "ts"`）或 glob（`glob: "**/*.tsx"`）縮小搜尋
- 透過 `multiline: true` 擷取跨行比對，如多行 struct 定義或 JSX 區塊

## 參數

- `pattern`（string，必填）：要搜尋的正規表示式。使用 ripgrep 語法，因此字面上的大括號需要轉義（例如用 `interface\{\}` 以尋找 `interface{}`）。
- `path`（string，選填）：要搜尋的檔案或目錄。預設為目前工作目錄。
- `glob`（string，選填）：檔名過濾，例如 `*.js` 或 `*.{ts,tsx}`。
- `type`（string，選填）：檔案類型捷徑，例如 `js`、`py`、`rust`、`go`。對於常見語言比 `glob` 更有效率。
- `output_mode`（enum，選填）：`files_with_matches`（預設，只回傳路徑）、`content`（回傳比對到的行）或 `count`（回傳比對次數）。
- `-i`（boolean，選填）：不分大小寫比對。
- `-n`（boolean，選填）：在 `content` 模式中顯示行號。預設為 `true`。
- `-A`（number，選填）：每個比對後顯示的上下文行數（需 `content` 模式）。
- `-B`（number，選填）：每個比對前顯示的上下文行數（需 `content` 模式）。
- `-C` / `context`（number，選填）：每個比對前後的上下文行數。
- `multiline`（boolean，選填）：允許模式跨越換行（`.` 可比對 `\n`）。預設為 `false`。
- `head_limit`（number，選填）：限制回傳的行數、檔案路徑或 count 條目。預設 250；傳入 `0` 表示不限制（請謹慎使用）。
- `offset`（number，選填）：在套用 `head_limit` 前略過前 N 筆結果。預設為 `0`。

## 範例

### 範例 1：找出某個函式的所有呼叫點
設 `pattern: "registerHandler\\("`、`output_mode: "content"`、`-C: 2`，以查看每個呼叫周圍的行。

### 範例 2：依類型統計比對次數
設 `pattern: "TODO"`、`type: "py"`、`output_mode: "count"`，查看 Python 原始碼中每個檔案的 TODO 總數。

### 範例 3：多行 struct 比對
搭配 `multiline: true` 使用 `pattern: "struct Config \\{[\\s\\S]*?version"`，擷取 Go struct 中幾行之內宣告的欄位。

## 注意事項

- 一律優先使用 `Grep`，而不是透過 `Bash` 執行 `grep` 或 `rg`；此工具針對正確權限與結構化輸出做了最佳化。
- 預設輸出模式為 `files_with_matches`，成本最低。只有在你真的需要看到內容時才切換到 `content`。
- 除非 `output_mode` 為 `content`，否則 context 旗標（`-A`、`-B`、`-C`）會被忽略。
- 大型結果集會消耗上下文 tokens。使用 `head_limit`、`offset` 或更緊的 `glob`/`type` 過濾器以保持聚焦。
- 檔名探索請改用 `Glob`；需要多輪開放式調查時，可以派發以 Explore 代理執行的 `Agent`。
