# Bash

在一個持續存在的工作目錄中執行 shell 指令，並回傳其 stdout/stderr。最好保留給沒有任何專屬 Claude Code 工具能表達的操作使用，例如執行 git、npm、docker 或建構指令稿。

## 使用時機

- 執行 git 操作（`git status`、`git diff`、`git commit`、`gh pr create`）
- 執行套件管理器與建構工具（`npm install`、`npm run build`、`pytest`、`cargo build`）
- 透過 `run_in_background` 在背景啟動長時間執行的程序（開發伺服器、watcher）
- 呼叫沒有內建對應工具的領域專屬 CLI（`docker`、`terraform`、`kubectl`、`gh`）
- 在先後順序很重要時，使用 `&&` 把相依步驟串接起來

## 參數

- `command`（string，必填）：要執行的確切 shell 指令。
- `description`（string，必填）：簡短、主動語態的摘要（簡單指令 5–10 字；管線或較冷門的指令可加上更多背景）。
- `timeout`（number，選填）：逾時毫秒數，最大 `600000`（10 分鐘）。預設 `120000`（2 分鐘）。
- `run_in_background`（boolean，選填）：為 `true` 時，指令會在背景執行，完成時你會收到通知。不要自己附加 `&`。

## 範例

### 範例 1：提交前檢查 repo 狀態
在同一則訊息中以兩個平行的 `Bash` 呼叫送出 `git status` 與 `git diff --stat`，快速蒐集背景資訊，之後再於後續呼叫中組裝 commit。

### 範例 2：串接相依的建構步驟
使用單一呼叫例如 `npm ci && npm run build && npm test`，每個步驟只有在前一步成功後才會執行。只有在你刻意希望後續步驟即使前面失敗也要執行時，才使用 `;`。

### 範例 3：長時間執行的開發伺服器
以 `run_in_background: true` 呼叫 `npm run dev`。該程序結束時你會收到通知。不要用 `sleep` 迴圈輪詢；請診斷失敗原因，而不是盲目重試。

## 注意事項

- 工作目錄會在呼叫之間保持，但 shell 狀態（export 的變數、shell 函式、別名）不會保留。優先使用絕對路徑，除非使用者要求，否則避免 `cd`。
- 優先使用專屬工具，而不是管線化的 shell 對應指令：用 `Glob` 取代 `find`/`ls`、`Grep` 取代 `grep`/`rg`、`Read` 取代 `cat`/`head`/`tail`、`Edit` 取代 `sed`/`awk`、`Write` 取代 `echo >` 或 heredoc，面向使用者的輸出以一般助理文字取代 `echo`/`printf`。
- 任何包含空白的路徑請以雙引號括起來（例如 `"/Users/me/My Project/file.txt"`）。
- 對於獨立指令，請在單一訊息中平行送出多個 `Bash` 呼叫。只有在一個指令依賴另一個時才使用 `&&` 串接。
- 超過 30000 個字元的輸出會被截斷。擷取大量記錄時，請重新導向至檔案，再用 `Read` 工具讀取。
- 不要使用互動旗標例如 `git rebase -i` 或 `git add -i`；它們無法透過此工具接收輸入。
- 除非使用者明確要求，不要略過 git hooks（`--no-verify`、`--no-gpg-sign`）或執行破壞性操作（`reset --hard`、`push --force`、`clean -f`）。
