# CC-Viewer

Claude Code 請求監控系統，即時擷取並視覺化展示 Claude Code 的所有 API 請求與回應（原始文字，不做刪減）。方便開發者監控自己的 Context，以便於 Vibe Coding 過程中回顧和排查問題。

[English](../README.md) | [简体中文](./README.zh.md) | 繁體中文 | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

### 安裝

```bash
npm install -g cc-viewer
```

### 執行與自動設定

```bash
ccv
```

該命令會自動偵測本地 Claude Code 的安裝方式（NPM 或 Native Install）並進行適配。

- **NPM 安裝**：自動向 Claude Code 的 `cli.js` 中注入攔截腳本。
- **Native Install**：自動偵測 `claude` 二進位檔案，設定本地透明代理，並設置 Zsh Shell Hook 自動轉發流量。

### 設定覆蓋 (Configuration Override)

如果您需要使用自訂 API 端點（例如企業代理），只需在 `~/.claude/settings.json` 中設定或設置 `ANTHROPIC_BASE_URL` 環境變數。`ccv` 會自動識別並正確轉發請求。

### 靜默模式 (Silent Mode)

預設情況下，`ccv` 在包裹 `claude` 執行時處於靜默模式，確保您的終端輸出保持整潔，與原生體驗一致。所有日誌都在背景擷取，並可透過 `http://localhost:7008` 查看。

設定完成後，正常使用 `claude` 命令即可。訪問 `http://localhost:7008` 查看監控介面。

### 常見問題排查 (Troubleshooting)

如果你遇到無法啟動的問題，有一個終極排查方案：
第一步：任意目錄開啟 claude code；
第二步：給 claude code 下指令，內容如下:
```
我已經安裝了 cc-viewer 這個 npm 套件，但是執行 ccv 以後仍然無法有效運行。查看 cc-viewer 的 cli.js 和 findcc.js，根據具體的環境，適配本地的 Claude Code 的部署方式。適配的時候修改範圍盡量約束在 findcc.js 中。
```
讓 Claude Code 自己檢查錯誤是比問任何人以及看任何文件更有效的手段！

以上指令完成後，會更新 findcc.js。如果你的專案工程經常需要本地部署，或者 fork 出去的程式碼要經常解決安裝問題，保留這個檔案就可以。下次直接 copy 檔案。現階段很多專案和公司用 claude code 都不是 mac 部署，而是伺服端託管部署，所以作者剝離了 findcc.js 這個檔案，方便後續追蹤 cc-viewer 的原始碼更新。

### 解除安裝

```bash
ccv --uninstall
```

### 檢查版本

```bash
ccv --version
```

## 功能

### 請求監控（原文模式）
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- 即時擷取 Claude Code 發出的所有 API 請求，確保是原文，而不是被刪減之後的日誌（這很重要！！！）
- 自動識別並標記 Main Agent 和 Sub Agent 請求（子類型：Bash、Task、Plan、General）
- MainAgent 請求支援 Body Diff JSON，摺疊展示與上一次 MainAgent 請求的差異（僅顯示變更/新增欄位）
- 每個請求內嵌顯示 Token 用量統計（輸入/輸出 Token、快取建立/讀取、命中率）
- 相容 Claude Code Router（CCR）及其他代理場景 — 透過 API 路徑模式兜底匹配請求

### 對話模式

點擊右上角「對話模式」按鈕，將 Main Agent 的完整對話歷史解析為聊天介面：
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- 暫不支援 Agent Team 的展示
- 使用者訊息右對齊（藍色氣泡），Main Agent 回覆左對齊（深色氣泡）
- `thinking` 區塊預設摺疊，以 Markdown 渲染，點擊展開查看思考過程；支援一鍵翻譯（功能還不穩定）
- 使用者選擇型訊息（AskUserQuestion）以問答形式展示
- 雙向模式同步：切換至對話模式時自動定位到選中請求對應的對話；切回原文模式時自動定位到選中的請求
- 設定面板：可切換工具結果和思考區塊的預設摺疊狀態


### 統計工具

Header 區域的「資料統計」懸浮面板：
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- 顯示 cache creation/read 數量及快取命中率
- 快取重建統計：按原因分組（TTL、system/tools/model 變更、訊息截斷/修改、key 變更）顯示次數和 cache_creation tokens
- 工具使用統計：按呼叫次數排序展示各工具的呼叫頻率
- Skill 使用統計：按呼叫次數排序展示各 Skill 的呼叫頻率
- 概念說明 (?) 圖示：點擊可查看 MainAgent、CacheRebuild 及各工具的內建文件

### 日誌管理

透過左上角 CC-Viewer 下拉選單：
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- 匯入本地日誌：瀏覽歷史日誌檔案，按專案分組，在新視窗開啟
- 載入本地 JSONL 檔案：直接選擇本地 `.jsonl` 檔案載入查看（支援最大 500MB）
- 目前日誌另存為：下載目前監控的 JSONL 日誌檔案
- 合併日誌：將多個 JSONL 日誌檔案合併為一個會話，統一分析
- 查看使用者 Prompt：提取並展示所有使用者輸入，支援三種查看模式 — 原文模式（原始內容）、上下文模式（系統標籤可摺疊）、Text 模式（純文字）；斜線命令（`/model`、`/context` 等）作為獨立條目展示；命令相關標籤自動從 Prompt 內容中隱藏
- 匯出 Prompt 為 TXT：將使用者 Prompt（純文字，不含系統標籤）匯出為本地 `.txt` 檔案

### 多語言支援

CC-Viewer 支援 18 種語言，根據系統語言環境自動切換：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

### 自動更新

CC-Viewer 啟動時自動檢查更新（每 4 小時最多一次）。同一大版本內（如 1.x.x → 1.y.z）自動更新，下次啟動生效。跨大版本僅顯示通知提示。

自動更新跟隨 Claude Code 全域設定 `~/.claude/settings.json`。如果 Claude Code 停用了自動更新（`autoUpdates: false`），CC-Viewer 也會跳過自動更新。

## License

MIT
