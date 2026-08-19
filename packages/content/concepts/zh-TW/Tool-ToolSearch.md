# ToolSearch

依需求取得「延遲載入工具」的完整結構描述（schema）定義，使其變為可呼叫。當有許多工具可用時，部分工具不會預先載入——它們只會在 `<system-reminder>` 訊息中以名稱出現。在取得其結構描述之前，只知道名稱而沒有參數定義，因此無法呼叫該工具。`ToolSearch` 接收一個查詢，將其與延遲載入工具清單比對，並在 `<functions>` 區塊中回傳相符工具的完整 JSONSchema 定義。一旦某個工具的結構描述出現在結果中，它就能像 prompt 開頭定義的任何工具一樣被呼叫。

## 使用時機

- 你需要某個延遲載入工具——它的名稱出現在 `<system-reminder>` 中，但最上層的工具清單裡沒有它的參數定義。
- 你想使用依需求載入的 MCP 伺服器工具（例如 Slack、Gmail、computer-use）。
- 你不確定某項功能對應的確切工具名稱，想用關鍵字一次浮現候選項目。

若某個工具的結構描述已在上下文中，不要再次搜尋——直接呼叫它即可。

## 啟用方式

- 預設開啟。
- 當 `ANTHROPIC_BASE_URL` 指向非 Anthropic 端點（除非設定了 `ENABLE_TOOL_SEARCH`）、設定了 `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`、模型缺乏工具參照支援（Claude 4.5 之前的 Vertex AI 模型），或透過 `"deny": ["ToolSearch"]` 拒絕時關閉。

## 參數

- `query`（string，必填）：用於定位延遲載入工具的查詢。支援三種形式：
  - `select:Read,Edit,Grep` — 以這些確切名稱取得工具。
  - `notebook jupyter` — 關鍵字搜尋，回傳最多 `max_results` 個最佳相符項目。
  - `+slack send` — 要求工具名稱中必須出現 `slack`，再依其餘字詞排序。
- `max_results`（number，選填）：回傳結果的最大數量。預設為 5。

## 範例

### 範例 1：以確切名稱取得

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### 範例 2：關鍵字搜尋

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### 範例 3：一次載入整套 MCP 工具組

當要批次載入某個 MCP 伺服器的每個工具（例如 computer-use）時，請使用單一關鍵字搜尋，而非逐一選取——伺服器名稱作為子字串會比對到該伺服器底下的所有工具：

```
ToolSearch(query="computer-use", max_results=30)
```

## 注意事項

- 呼叫延遲載入工具之前，你必須先用 `ToolSearch` 取得它的結構描述——直接呼叫會失敗，因為缺少參數定義。
- 批次載入整套工具組（例如某個 MCP 伺服器的所有工具）時，請優先使用一次關鍵字搜尋，而非多次 `select:` 呼叫，以減少來回次數。
- 一旦取得結構描述，該工具的行為就與任何一般工具完全相同；不要重複搜尋同一個工具。
- 結果以 `<functions>` 區塊回傳，每個工具是單一一行 `<function>{...}</function>`——與最上層工具清單相同的編碼方式。
