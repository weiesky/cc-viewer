# Edit

在既有檔案中進行精確的字串替換。這是修改檔案的首選方式，因為只傳輸 diff，能讓編輯精確且可審核。

## 使用時機

- 修正單一函式中的 bug，而不重寫周圍整個檔案
- 更新設定值、版本字串或 import 路徑
- 使用 `replace_all` 在整個檔案中重新命名符號
- 在某個錨點附近插入區塊（擴大 `old_string` 以包含附近的上下文，然後提供替換內容）
- 在多步驟重構中套用小而有明確範圍的編輯

## 參數

- `file_path`（string，必填）：要修改的檔案絕對路徑。
- `old_string`（string，必填）：要搜尋的確切文字。必須逐字完全相符，包括空白與縮排。
- `new_string`（string，必填）：替換文字。必須與 `old_string` 不同。
- `replace_all`（boolean，選填）：為 `true` 時會取代 `old_string` 的每一個出現處。預設為 `false`，此時要求比對結果必須唯一。

## 範例

### 範例 1：修正單一呼叫點
將 `old_string` 設為精確的一行 `const port = 3000;`，`new_string` 設為 `const port = process.env.PORT ?? 3000;`。由於比對唯一，`replace_all` 可保持預設值。

### 範例 2：在整個檔案中重新命名符號
要把 `api.ts` 內的 `getUser` 全部改為 `fetchUser`，請設 `old_string: "getUser"`、`new_string: "fetchUser"`、`replace_all: true`。

### 範例 3：消除重複片段的歧義
若 `return null;` 在多個分支中都出現，請擴大 `old_string` 包含周圍上下文（例如前面的 `if` 行），以確保比對唯一。否則工具會報錯而不是去猜測。

## 注意事項

- 在目前工作階段中，你必須先對該檔案呼叫過至少一次 `Read`，`Edit` 才會接受變更。`Read` 輸出中的行號前綴不是檔案內容的一部分；請不要將其納入 `old_string` 或 `new_string`。
- 空白字元必須完全相符。注意 tab 與空格、行尾空白，特別是在 YAML、Makefile 與 Python 中。
- 若 `old_string` 不唯一且 `replace_all` 為 `false`，編輯會失敗。請擴充上下文或啟用 `replace_all`。
- 只要檔案已存在，請優先使用 `Edit` 而不是 `Write`；`Write` 會覆寫整個檔案，不小心就會遺失無關的內容。
- 對同一檔案做多處不相關的修改時，請依序送出多個 `Edit` 呼叫，而不是單一大型、脆弱的替換。
- 編輯原始碼時請避免引入 emoji、行銷文案或未請求的說明文件區塊。
