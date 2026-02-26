# CC-Viewer

Claude Code 請求監控系統，即時擷取並視覺化展示 Claude Code 的所有 API 請求與回應。方便開發者監控自己的 Context，以便於 Vibe Coding 過程中回顧和排查問題。

[简体中文](./README.zh.md) | [English](../README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

### 安裝

```bash
npm install -g cc-viewer
```

### 運行與自動配置

```bash
ccv
```

該命令會自動檢測本地 Claude Code 的安裝方式（NPM 或 Native Install）並進行適配。

- **NPM 安裝**：自動向 Claude Code 的 `cli.js` 中注入攔截腳本。
- **Native Install**：自動檢測 `claude` 二進制文件，配置本地透明代理，並設置 Zsh Shell Hook 自動轉發流量。

### 配置覆蓋 (Configuration Override)

如果您需要使用自定義 API 端點（例如企業代理），只需在 `~/.claude/settings.json` 中配置或設置 `ANTHROPIC_BASE_URL` 環境變量。`ccv` 會自動識別並正確轉發請求。

### 靜默模式 (Silent Mode)

默認情況下，`ccv` 在包裹 `claude` 運行時處於靜默模式，確保您的終端輸出保持整潔，與原生體驗一致。所有日誌都在後台捕獲，並可通過 `http://localhost:7008` 查看。

配置完成後，正常使用 `claude` 命令即可。訪問 `http://localhost:7008` 查看監控介面。

### 常見問題排查 (Troubleshooting)

- **混合輸出 (Mixed Output)**：如果您看到 `[CC-Viewer]` 調試日誌與 Claude 的輸出混雜在一起，請更新到最新版本 (`npm install -g cc-viewer`)。
- **連接被拒絕 (Connection Refused)**：請確保 `ccv` 後台進程正在運行。運行 `ccv` 或 `claude`（安裝 Hook 後）應會自動啟動它。
- **無 Body (Empty Body)**：如果您在 Viewer 中看到 "No Body"，可能是由於非標準的 SSE 格式。Viewer 現已支持作為兜底方案捕獲原始內容。

### 檢查版本

```bash
ccv --version
```

### 解除安裝

```bash
ccv --uninstall
```

## 功能

### 請求監控（原文模式）

- 即時擷取 Claude Code 發出的所有 API 請求，包括串流回應
- 左側請求列表展示請求方法、URL、耗時、狀態碼
- 自動識別並標記 Main Agent 和 Sub Agent 請求（子類型：Bash、Task、Plan、General）
- 請求列表自動捲動至選中項目（模式切換時居中顯示，手動點擊時就近捲動）
- 右側詳情面板支援 Request / Response 兩個 Tab 切換查看
- Request Body 中 `messages`、`system`、`tools` 預設展開一層子屬性
- Response Body 預設全部展開
- 支援 JSON 檢視與純文字檢視切換
- 支援一鍵複製 JSON 內容
- MainAgent 請求支援 Body Diff JSON，摺疊展示與上一次 MainAgent 請求的差異（僅顯示變更/新增欄位）
- Diff 區塊支援 JSON/Text 檢視切換及一鍵複製
- 「展開 Diff」設定：啟用後 MainAgent 請求自動展開 Diff 區塊
- Body Diff JSON 提示框支援關閉，關閉後伺服器端持久化偏好，永不再顯示
- 敏感請求標頭（`x-api-key`、`authorization`）在 JSONL 日誌檔案中自動脫敏，防止憑證洩露
- 每個請求內嵌顯示 Token 用量統計（輸入/輸出 Token、快取建立/讀取、命中率）
- 相容 Claude Code Router（CCR）及其他代理場景 — 透過 API 路徑模式兜底匹配請求

### 對話模式

點擊右上角「對話模式」按鈕，將 Main Agent 的完整對話歷史解析為聊天介面：

- 使用者訊息右對齊（藍色氣泡），Main Agent 回覆左對齊（深色氣泡），支援 Markdown 渲染
- `/compact` 訊息自動偵測並摺疊顯示，點擊展開完整摘要
- 工具呼叫結果內嵌顯示在對應的 Assistant 訊息內部
- `thinking` 區塊預設摺疊，以 Markdown 渲染，點擊展開查看思考過程；支援一鍵翻譯
- `tool_use` 顯示為緊湊的工具呼叫卡片（Bash、Read、Edit、Write、Glob、Grep、Task 等均有專屬展示）
- Task（SubAgent）工具結果以 Markdown 渲染
- 使用者選擇型訊息（AskUserQuestion）以問答形式展示
- 系統標籤（`<system-reminder>`、`<project-reminder>` 等）自動摺疊
- Skill 載入訊息自動識別並摺疊顯示 Skill 名稱，點擊展開查看完整文件（Markdown 渲染）
- Skills reminder 自動識別並摺疊
- 自動過濾系統文字，只展示使用者的真實輸入
- 支援多 session 分段展示（`/compact`、`/clear` 等操作後自動分段）
- 每條訊息顯示精確到秒的時間戳，基於 API 請求時間推算
- 每條訊息附帶「查看請求」連結，可跳轉回原文模式對應的 API 請求
- 雙向模式同步：切換至對話模式時自動捲動至選中請求對應的對話；切換回原文模式時自動捲動至選中的請求
- 設定面板：可切換工具結果和思考區塊的預設摺疊狀態
- 全域設定：可切換是否過濾無關請求（count_tokens、心跳請求）

### 翻譯

- thinking 區塊和 Assistant 訊息支援一鍵翻譯
- 基於 Claude Haiku API，僅使用 `x-api-key` 認證（排除 OAuth session token 以防止上下文污染）
- 自動從 mainAgent 請求中擷取 haiku 模型名稱；預設使用 `claude-haiku-4-5-20251001`
- 翻譯結果自動快取，再次點擊可切換回原文
- 翻譯過程中顯示載入旋轉動畫
- 請求詳情中 `authorization` header 旁的 (?) 圖示可查看上下文污染說明文件

### Token 消耗統計

Header 區域的「Token 消耗統計」懸浮面板：

- 按模型分組統計 input/output token 數量
- 顯示 cache creation/read 數量及快取命中率
- 快取重建統計：依原因分組（TTL、system/tools/model 變更、訊息截斷/修改、key 變更），顯示次數與 cache_creation tokens
- 工具使用統計：每個工具的呼叫次數，依頻率排序
- Skill 使用統計：按調用次數排序展示各 Skill 的調用頻率
- 概念說明 (?) 圖示：點擊可查看 MainAgent、CacheRebuild 及各工具的內建文件
- Main Agent 快取失效倒數計時

### 日誌管理

透過左上角 CC-Viewer 下拉選單：

- 匯入本地日誌：瀏覽歷史日誌檔案，按專案分組，在新視窗開啟
- 載入本地 JSONL 檔案：直接選擇並載入本地 `.jsonl` 檔案（最大 500MB）
- 下載當前日誌：下載當前監控的 JSONL 日誌檔案
- 合併日誌：將多個 JSONL 日誌檔案合併為一個會話，統一分析
- 當前日誌另存為：下載當前監控的 JSONL 日誌檔案
- 查看用戶 Prompt：提取並展示所有用戶輸入，支援三種查看模式 — 原文模式（原始內容）、上下文模式（系統標籤可摺疊）、Text 模式（純文字）；斜線命令（`/model`、`/context` 等）作為獨立條目展示；命令相關標籤自動從 Prompt 內容中隱藏
- 匯出 Prompt 為 TXT：將使用者 Prompt（純文字，不含系統標籤）匯出為本地 `.txt` 檔案

### 多語言支援

CC-Viewer 支援 18 種語言，根據系統語言環境自動切換：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
