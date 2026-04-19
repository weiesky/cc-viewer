# CC-Viewer

Claude Code 請求監控系統，即時捕獲並視覺化展示 Claude Code 的所有 API 請求與回應（原始文字，不做刪減）。方便開發者監控自己的 Context，以便於 Vibe Coding 過程中回顧和排查問題。
最新版本的 CC-Viewer 還提供了伺服器部署 Web 程式設計的方案，以及行動端程式設計的工具。歡迎大家在自己的專案中應用，未來也將開放更多外掛功能，支援雲端部署。

先看有趣的部分，你可以在行動端上看到：

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | 繁體中文 | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

### 安裝

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### 程式設計模式

ccv 是 claude 的直接替身，所有參數透傳給 claude，同時啟動 Web Viewer。

```bash
ccv                    # == claude（互動模式）
ccv -c                 # == claude --continue（繼續上次對話）
ccv -r                 # == claude --resume（恢復對話）
ccv -p "hello"         # == claude --print "hello"（列印模式）
ccv --d                # == claude --dangerously-skip-permissions（快捷方式）
ccv --model opus       # == claude --model opus
```

作者本人常用的指令是
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

程式設計模式啟動以後，會主動開啟 Web 頁面。

你可以在 Web 頁面裡面直接使用 Claude，同時可以查看完整的請求報文和查看程式碼變更。

以及看上去更酷的，你甚至可以用行動端程式設計！


### 日誌模式

⚠️如果你仍然習慣使用 claude 原生工具，或者 VS Code 外掛，請使用該模式。

這個模式下面啟動 ```claude``` 或者 ```claude --dangerously-skip-permissions```

會自動啟動一個日誌程序自動記錄請求日誌到 ~/.claude/cc-viewer/*yourproject*/date.jsonl

啟動日誌模式：
```bash
ccv -logger
```

在控制台無法列印具體連接埠的時候，預設第一個啟動連接埠是 127.0.0.1:7008。同時存在多個末尾順延，如 7009、7010

該指令會自動偵測本地 Claude Code 的安裝方式（NPM 或 Native Install）並進行適配。

- **NPM 版本 Claude Code**：自動向 Claude Code 的 `cli.js` 中注入攔截腳本。
- **Native 版本 Claude Code**：自動偵測 `claude` 二進位檔案，設定本地透明代理，並設置 Zsh Shell Hook 自動轉發流量。
- 本專案更推薦使用 npm 方式安裝的 Claude Code。

解除安裝日誌模式：
```bash
ccv --uninstall
```

### 常見問題排查 (Troubleshooting)

如果你遇到無法啟動的問題，有一個終極排查方案：
第一步：任意目錄開啟 Claude Code；
第二步：給 Claude Code 下指令，內容如下：
```
我已經安裝了 cc-viewer 這個 npm 套件，但是執行 ccv 以後仍然無法有效運行。查看 cc-viewer 的 cli.js 和 findcc.js，根據具體的環境，適配本地的 Claude Code 的部署方式。適配的時候修改範圍儘量約束在 findcc.js 中。
```
讓 Claude Code 自己檢查錯誤是比諮詢任何人以及看任何文件更有效的手段！

以上指令完成後，會更新 findcc.js。如果你的專案工程經常需要本地部署。或者 fork 出去的程式碼要經常解決安裝問題，保留這個檔案就可以。下次直接 copy 檔案。現階段很多專案和公司用 Claude Code 都不是 Mac 部署，而是伺服器端託管部署，所以作者剝離了 findcc.js 這個檔案，方便後續追蹤 cc-viewer 的原始碼更新。

### 其他輔助指令

查閱
```bash
ccv -h
```

### 設定覆蓋 (Configuration Override)

如果您需要使用自訂 API 端點（例如企業代理），只需在 `~/.claude/settings.json` 中設定或設置 `ANTHROPIC_BASE_URL` 環境變數。`ccv` 會自動識別並正確轉發請求。

### 靜默模式 (Silent Mode)

預設情況下，`ccv` 在包裹 `claude` 運行時處於靜默模式，確保您的終端輸出保持整潔，與原生體驗一致。所有日誌都在後台捕獲，並可透過 `http://localhost:7008` 查看。

設定完成後，正常使用 `claude` 指令即可。存取 `http://localhost:7008` 查看監控介面。


## 客戶端版本

cc-viewer 提供了客戶端版本，你可以在 GitHub 上下載到對應的客戶端版本。
[下載地址](https://github.com/weiesky/cc-viewer/releases)
目前客戶端版本在測試階段，有問題可以隨時回饋。另外 cc-viewer 的使用前提是你本地有 Claude Code。
需要注意的是：cc-viewer 始終只是工人（Claude Code）的一件「衣服」，沒有 Claude Code，衣服是無法獨立工作的。

## 功能


### 程式設計模式

在使用 ccv 啟動以後可以看見：

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


你可以在編輯完成以後直接查看程式碼 diff：

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

雖然你可以開啟檔案手動程式設計，但是並不推薦使用手動程式設計，那是古法程式設計！

### 行動端程式設計

你甚至可以掃碼，實現在行動端裝置上程式設計：

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

滿足你對行動端程式設計的想像，另外還有外掛機制，如果你需要針對自己的程式設計習慣定製，後續可以跟進外掛的 hooks 更新。

**語音輸入**：點選聊天框的麥克風圖示即可語音轉文字（基於 Web Speech API；需要 HTTPS 或 localhost，LAN HTTP 存取時按鈕不會出現）。Android 使用者可直接使用 Gboard 鍵盤上的 🎤 按鈕，iOS 使用者可使用系統鍵盤內建的聽寫功能 —— 兩者都無需 HTTPS 且支援離線。

### 日誌模式（查看 Claude Code 完整會話）

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- 即時捕獲 Claude Code 發出的所有 API 請求，確保是原文，而不是被刪減之後的日誌（這很重要！！！）
- 自動識別並標記 Main Agent 和 Sub Agent 請求（子型別：Plan、Search、Bash）
- MainAgent 請求支援 Body Diff JSON，摺疊展示與上一次 MainAgent 請求的差異（僅顯示變更/新增欄位）
- 每個請求內嵌顯示 Token 用量統計（輸入/輸出 Token、快取建立/讀取、命中率）
- 相容 Claude Code Router（CCR）及其他代理場景 — 透過 API 路徑模式兜底匹配請求

### 對話模式

點擊右上角「對話模式」按鈕，將 Main Agent 的完整對話歷史解析為聊天介面：

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- 暫不支援 Agent Team 的展示
- 使用者訊息右對齊（藍色氣泡），Main Agent 回覆左對齊（深色氣泡）
- `thinking` 區塊預設摺疊，以 Markdown 渲染，點擊展開查看思考過程；支援一鍵翻譯（功能還不穩定）
- 使用者選擇型訊息（AskUserQuestion）以問答形式展示
- 雙向模式同步：切換到對話模式時自動定位到選中請求對應的對話；切回原文模式時自動定位到選中的請求
- 設定面板：可切換工具結果和思考區塊的預設摺疊狀態
- 手機端對話瀏覽：在手機端 CLI 模式下，點擊頂部欄的「對話瀏覽」按鈕，即可滑出唯讀對話視圖，在手機上瀏覽完整對話歷史

### 統計工具

Header 區域的「資料統計」懸浮面板：

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- 顯示 cache creation/read 數量及快取命中率
- 快取重建統計：按原因分組（TTL、system/tools/model 變更、訊息截斷/修改、key 變更）顯示次數和 cache_creation tokens
- 工具使用統計：按呼叫次數排序展示各工具的呼叫頻率
- Skill 使用統計：按呼叫次數排序展示各 Skill 的呼叫頻率
- 支援 teammate 的統計
- 概念幫助 (?) 圖示：點擊可查看 MainAgent、CacheRebuild 及各工具的內建文件

### 日誌管理

透過左上角 CC-Viewer 下拉選單：
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**日誌的壓縮**
關於日誌這個部分，作者需要聲明，作者保證沒有修改 Anthropic 的官方定義，以確保日誌的完整性。
但是由於 1M 的 Opus 後期產生的單條日誌過於龐大，得益於作者採取了對 MainAgent 的一些日誌最佳化，在沒有 gzip 的情況下，可以降低至少 66% 的體積。
這個壓縮日誌的解析方法，可以從當前倉庫中擷取。

### 更多便捷有用的功能

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

你可以透過側邊欄工具快速定位你的 prompt

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

有趣的 KV-Cache-Text，能幫你看見 Claude 看到的東西是什麼

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

你可以上傳圖片說出你的需求，Claude 對圖片的理解能力非常強大，同時你知道，你可以截圖直接 Ctrl+V 直接貼上圖片，對話裡面可以顯示你的完整內容

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

你可以直接自訂外掛、管理 CC-Viewer 所有程序以及 CC-Viewer 擁有對第三方介面的熱切換能力（沒錯，你可以使用 GLM、Kimi、MiniMax、Qwen、DeepSeek，雖然作者認為他們現在都很弱）

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

更多功能等你發現...比如：本系統支援 Agent Team，以及內建了 Code Reviewer。馬上就要適配 Codex 的 Code Reviewer 引入（作者很推崇使用 Codex 給 Claude Code Review 程式碼）


### 自動更新

CC-Viewer 啟動時自動檢查更新（每 4 小時最多一次）。同一大版本內（如 1.x.x -> 1.y.z）自動更新，下次啟動生效。跨大版本僅顯示通知提示。

自動更新跟隨 Claude Code 全域設定 `~/.claude/settings.json`。如果 Claude Code 停用了自動更新（`autoUpdates: false`），CC-Viewer 也會跳過自動更新。

### 多語言支援

CC-Viewer 支援 18 種語言，根據系統語言環境自動切換：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
