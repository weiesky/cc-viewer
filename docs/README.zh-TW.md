# CC-Viewer

Claude Code 請求監控系統，即時擷取並視覺化展示 Claude Code 的所有 API 請求與回應。方便開發者監控自己的 Context，以便於 Vibe Coding 過程中回顧和排查問題。

[简体中文](./README.zh.md) | [English](../README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

```bash
npm install -g cc-viewer
```

安裝完成後執行：

```bash
ccv
```

該命令會自動配置本地安裝的 Claude Code 以啟用監控，並在 shell 設定檔（`~/.zshrc` 或 `~/.bashrc`）中新增自動修復 hook。之後正常使用 Claude Code，開啟瀏覽器存取 `http://localhost:7008` 即可查看監控介面。

Claude Code 更新後無需手動操作，下次執行 `claude` 時會自動偵測並重新配置。

### 解除安裝

```bash
ccv --uninstall
```

## 功能

### 請求監控（原文模式）

- 即時擷取 Claude Code 發出的所有 API 請求，包括串流回應
- 左側請求列表展示請求方法、URL、耗時、狀態碼
- 自動識別並標記 Main Agent 和 Sub Agent 請求（子類型：Bash、Task、Plan、General）
- 右側詳情面板支援 Request / Response 兩個 Tab 切換查看
- Request Body 中 `messages`、`system`、`tools` 預設展開一層子屬性
- Response Body 預設全部展開
- 支援 JSON 檢視與純文字檢視切換
- 支援一鍵複製 JSON 內容
- MainAgent 請求支援 Body Diff JSON，摺疊展示與上一次 MainAgent 請求的差異（僅顯示變更/新增欄位）
- Body Diff JSON 提示框支援關閉，關閉後伺服器端持久化偏好，永不再顯示

### 對話模式

點擊右上角「對話模式」按鈕，將 Main Agent 的完整對話歷史解析為聊天介面：

- 使用者訊息右對齊（藍色氣泡），Main Agent 回覆左對齊（深色氣泡），支援 Markdown 渲染
- `/compact` 訊息自動偵測並摺疊顯示，點擊展開完整摘要
- 工具呼叫結果內嵌顯示在對應的 Assistant 訊息內部
- `thinking` 區塊預設摺疊，點擊展開查看思考過程
- `tool_use` 顯示為緊湊的工具呼叫卡片（Bash、Read、Edit、Write、Glob、Grep、Task 等均有專屬展示）
- 使用者選擇型訊息（AskUserQuestion）以問答形式展示
- 系統標籤（`<system-reminder>`、`<project-reminder>` 等）自動摺疊
- 自動過濾系統文字，只展示使用者的真實輸入
- 支援多 session 分段展示（`/compact`、`/clear` 等操作後自動分段）
- 每條訊息顯示精確到秒的時間戳

### Token 消耗統計

Header 區域的「Token 消耗統計」懸浮面板：

- 按模型分組統計 input/output token 數量
- 顯示 cache creation/read 數量及快取命中率
- Main Agent 快取失效倒數計時

### 日誌管理

透過左上角 CC-Viewer 下拉選單：

- 匯入本地日誌：瀏覽歷史日誌檔案，按專案分組，在新視窗開啟
- 載入本地 JSONL 檔案：直接選擇並載入本地 `.jsonl` 檔案（最大 200MB）
- 下載當前日誌：下載當前監控的 JSONL 日誌檔案
- 匯出使用者 Prompt：擷取並展示所有使用者輸入，XML 標籤（system-reminder 等）可摺疊查看；斜線命令（`/model`、`/context` 等）作為獨立條目展示；命令相關標籤自動從 Prompt 內容中隱藏
- 匯出 Prompt 為 TXT：將使用者 Prompt（純文字，不含系統標籤）匯出為本地 `.txt` 檔案

### 多語言支援

CC-Viewer 支援 18 種語言，根據系統語言環境自動切換：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
