# CC-Viewer

🌐 **官網與功能導覽: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — 支援 18 種語言。


基於 Claude Code，提煉自身開發經驗、沉澱而成的 Vibe Coding 工具：

1. 提升能力上限，可在本機執行 /ultraPlan、/ultraReview，同時避免將專案程式碼完全暴露給 Claude 雲端；
2. 多端同時適配，可在區域網路內實現行動裝置程式設計，Web 版自適應各種場景，方便嵌入瀏覽器擴充功能、作業系統分割畫面，並提供原生安裝包；
3. 完整日誌留痕，提供 Claude Code 完整封包攔截分析能力，方便記錄日誌、分析問題、學習借鑑、逆向研發；
4. 學習經驗分享，沉澱了大量學習資料與開發經驗（詳見系統中各處的「?」中）；
5. 保持原生體驗，僅對 Claude Code 能力進行增強，對核心無任何實質性修改，保持原生體驗；
6. 適配三方模型，已適配 deepseek-v4-\*、GLM 5.1、Kimi K2.6，內建 cc-switch 能力，可隨時熱切第三方工具；代理熱切換還支援按角色分源——主 Agent、子 Agent、Teammate 可各自使用不同的代理 profile（預設跟隨主 Agent）；當主 Agent 使用內建 Default 且為官方端點時，角色分配入口隱藏、已配置分配休眠不生效。

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | 繁體中文 | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方式

### 前提

* 請確認已安裝 nodejs 20.0.0+；[下載安裝](https://nodejs.org)
* 請確認已安裝 claude code；[安裝教學](https://github.com/anthropics/claude-code)

### 安裝 ccv

#### 透過 npm 安裝

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### 透過 Homebrew 安裝（macOS / Linux 推薦）

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # 升級請用這個，brew 安裝的 ccv 不要用 npm install -g 升級
```

#### 透過 pnpm 安裝（全域）

```bash
pnpm add -g cc-viewer
pnpm add -g cc-viewer@latest   # 升級請用這個，pnpm 安裝的 ccv 不要用 npm install -g 升級
```

### 啟動方式

ccv 是 claude 的直接替身，所有參數透傳給 claude，同時啟動 Web Viewer。

```bash
ccv                    # == claude（互動模式）
```

我最常用的指令是：

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv 透傳所有 claude code 的啟動參數，你可以自行任意組合使用
```

程式設計模式啟動之後，會主動開啟 web 頁面。

cc-viewer 也提供了客戶端版本：[下載連結](https://github.com/weiesky/cc-viewer/releases)

### SDK 模式（headless，`ccv -SDK`）

`ccv -SDK` 會透過 Agent SDK 執行工作階段，而不是互動式終端機——沒有終端機面板，訊息從 Web UI 發送，其他一切（工作階段日誌、串流打字機效果、用量統計）都與終端機模式相同。

```bash
ccv -SDK                # 無介面工作階段；從瀏覽器聊天
ccv -SDK -c             # 繼續最近的工作階段
ccv -SDK --model sonnet # 選擇模型
```

審批（Bash/Edit/Write/WebFetch/…）會以 允許 / 拒絕 / 本次工作階段允許 的形式在瀏覽器中彈出，`AskUserQuestion` / 計畫提示則以模式對話框出現。`npm publish` 一律要求明確審批——即使帶 `--d` 亦然。需要 `@anthropic-ai/claude-agent-sdk` 套件（隨 cc-viewer 一起打包）；若無法使用則退回終端機模式。

### 升級到 1.7.0（日誌格式 v2）

自 1.7.0 起，日誌以「每工作階段目錄」格式（wire-format v2）儲存，不再使用單一 `.jsonl` 檔案——磁碟佔用約減少 90%。既有的 v1 `.jsonl` 檔案不會被修改或刪除；日誌對話框預設會列出 v2 工作階段，並提供一個小的「檢視舊版（v1）日誌」項目（只要舊檔案還存在便會顯示），點選後會開啟 v1 檢視，可在其中檢視、遷移或刪除它們。啟動時，若發現舊版日誌，cc-viewer 會提供一鍵遷移（在使用 `claude -c` 繼續舊對話時強烈建議遷移，因為這類對話的前半部分儲存在舊檔案中）。你也可以在終端機中遷移：

```bash
ccv convert <project>   # 遷移單個專案
ccv convert --all       # 遷移所有專案
ccv verify <v1-file>    # 對照轉換後的工作階段校驗某個 v1 檔案
```

某個工作階段未通過 golden 校驗時，會被暫存到 `sessions-quarantine/` 待檢查，而不會讓整次遷移失敗——其餘工作階段照常遷移。

### 日誌模式

如果你仍習慣使用 claude 原生工具，或 VS Code 擴充功能，請使用此模式。

此模式下啟動 `claude`

會自動啟動一個日誌行程，將請求日誌自動記錄到 \~/.claude/cc-viewer/*yourproject*/sessions/ 下的每工作階段目錄（wire-format v2）

啟動日誌模式：

```bash
ccv -logger
```

在主控台無法印出具體連接埠時，預設第一個啟動連接埠是 127.0.0.1:7008。同時存在多個則往後順延，如 7009、7010

解除安裝日誌模式：

```bash
ccv --uninstall
```

### 常見問題排查 (Troubleshooting)

如果你遇到無法啟動的問題，有一個終極排查方案：
第一步：任意目錄打開 claude code；
第二步：給 claude code 下指令，內容如下：

```
我已經安裝了 cc-viewer 這個 npm 套件，但執行 ccv 之後仍然無法正常運作。請查看 cc-viewer 的 cli.js 與 findcc.js，根據具體環境，適配本地 claude code 的部署方式。適配時請盡量將修改範圍限制在 findcc.js 中。
```

讓 Claude Code 自行檢查錯誤，比諮詢任何人或閱讀任何文件都更有效！

以上指令完成後，會更新 findcc.js。如果你的專案經常需要本地部署，或者 fork 出去的程式碼經常需要解決安裝問題，保留這個檔案就好。下次直接 copy 檔案即可。現階段很多專案和公司使用 claude code 都不是 Mac 部署，而是伺服器端託管部署，所以我剝離了 findcc.js 這個檔案，方便後續追蹤 cc-viewer 的原始碼更新。

注意：本應用與 claude-code-switch、claude-code-router 是衝突的，存在 proxy 競爭的問題，使用時務必關閉 claude-code-switch、claude-code-router，cc-viewer 內部提供了代理熱更新的功能可以平替。

### 其他輔助指令

查閱：

```bash
ccv -h
```

### 靜默模式 (Silent Mode)

預設情況下，`ccv` 在包裹 `claude` 執行時處於靜默模式，確保你的終端輸出保持整潔，與原生體驗一致。所有日誌都在背景捕獲，並可透過 `http://localhost:7008` 檢視。

設定完成後，正常使用 `claude` 指令即可。造訪 `http://localhost:7008` 即可開啟監控介面。

## 功能

### 程式設計模式

使用 ccv 啟動後可以看見：

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

你可以在編輯完成後直接查看程式碼 diff：

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

雖然你可以打開檔案手動程式設計，但並不推薦使用手動程式設計，那是古法程式設計！

### 行動端程式設計

你甚至可以掃描 QR Code，在行動裝置上進行程式設計：

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

滿足你對行動端程式設計的想像，另外還有外掛機制，如果你需要針對自己的程式設計習慣客製化，後續可以關注外掛 hooks 的更新。

### 按模型定制系統提示詞

**編輯系統提示詞**模態框（漢堡選單 → 編輯系統提示詞）採用分頁設計：

* **預設**分頁保留經典行為：它會將 `CC_SYSTEM.md`（覆蓋）或 `CC_APPEND_SYSTEM.md`（追加）寫入目前工作區，並在下次 ccv 啟動時以 `--system-prompt-file` / `--append-system-prompt-file` 注入。
* **模型分頁**：點擊 **+ 新增模型**，輸入名稱（例如 `opus` 或 `Gemini3`），並選擇作用範圍——**全域**（`~/.claude/cc-viewer/system_prompt/`，套用於所有工作區）或**工作區**（`<project>/system_prompt/`）。名稱輸入框會根據本地已設定的模型提供輸入建議（來自熱更新的代理設定和 `settings.json`）；所選作用範圍中已新增的名稱會被隱藏，仍可輸入任意自訂名稱。每個分頁都有自己的追加/覆蓋開關和 Markdown 預覽。
* 條目以大寫檔名儲存：`OPUS_SYSTEM.md`（覆蓋）或 `OPUS_APPEND_SYSTEM.md`（追加）。比對採模糊方式——以「目前生效設定」解析出的模型 ID 做不區分大小寫子字串比對（啟用的第三方 proxy profile 模型對應 > 啟動環境變數 `ANTHROPIC_MODEL`/`CLAUDE_MODEL` > `settings.json` 設定的 `model`；無任何設定訊號則不注入條目），因此無論版本為何，`opus` 都能比對到 `claude-opus-4-8[1m]`。已知限制：工作階段中途切換 proxy profile 需重新啟動 claude 工作階段才會重新比對；經額外參數透傳的 `--model` 不參與解析。工作區比對優先於全域比對；同一作用範圍內名稱最長者勝出；比對到的條目會在該次啟動中完全取代預設分頁的檔案。
* **內建預設依預設生效：**套件為 `deepseek-v4-pro`、`deepseek-v4-flash`、`GLM-5.2`、`Qwen-3.7-Max`、`kimi-k2.7-code` 與 `kimi-k3` 內建了調校過的提示詞——當解析出的模型匹配其中之一、且沒有你自己的條目匹配時，內建提示詞會自動注入（你自己的檔案永遠優先：工作區 > 全域 > 內建）。內建分頁在模態框中帶有 **內建** 徽章：編輯並儲存即可產生你的覆寫條目，或使用分頁上的 × 來 **停用** 某個內建項目（記錄於 `<scope>/system_prompt/.builtin-disabled.json`）。被停用的內建項目會回退到預設分頁的檔案，標頭條目仍保持可見並標記為「已停用」，你可以隨時重新啟用。
* 將分頁儲存為空白即可刪除該條目。工作階段中途切換模型會在下次重新啟動時生效。設定 `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` 可停用所有自動注入。你可以將 `<project>/system_prompt/` 提交到版本庫與團隊共享提示詞，也可以將其加入 `.gitignore` 保持私有。

### 日誌模式（檢視 claude code 完整對話）

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* 即時擷取 Claude Code 發出的所有 API 請求，確保是原文，而不是被閹割之後的日誌（這非常重要！！！）
* 自動辨識並標記 Main Agent 與 Sub Agent 請求（子類型：Plan、Search、Bash）
* MainAgent 請求支援 Body Diff JSON，折疊顯示與上一次 MainAgent 請求的差異（僅顯示變更/新增欄位）
* 每個請求行內顯示 Token 用量統計（輸入/輸出 Token、快取建立/讀取、命中率）
* 相容 Claude Code Router（CCR）及其他代理場景 — 透過 API 路徑模式兜底匹配請求

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## License

MIT
