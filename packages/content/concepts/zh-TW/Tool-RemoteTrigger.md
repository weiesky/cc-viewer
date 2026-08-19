# RemoteTrigger

呼叫 claude.ai 遠端觸發器 API，用於管理排程任務和按需觸發執行。OAuth 權杖由工具內部處理，不會暴露給模型或 shell。

## 使用時機

- 管理 claude.ai 上的遠端代理程式（觸發器），包括列出、檢視和更新現有觸發器
- 建立以 cron 排程為基礎的自動化任務，讓 Claude 代理程式按週期性排程執行
- 按需觸發現有觸發器，無需等待其下一次排程執行時間
- 列出或稽核所有目前的觸發器，以檢視其設定和狀態
- 更新觸發器設定，例如排程、負載或說明，而無需重新建立觸發器

## 啟用方式

- 需要 claude.ai Pro、Max、Team 或 Enterprise 方案。
- 在 Amazon Bedrock、Claude Platform on AWS、Google Cloud 或 Microsoft Foundry 上不可用。
- 需要伺服器端功能旗標以及 `allow_remote_sessions` / `allow_routines` 政策設定。
- 不適用於遠端工作階段本身。

## 參數

- `action` (string, 必填)：要執行的操作 — 可選值為 `list`、`get`、`create`、`update` 或 `run`
- `trigger_id` (string, `get`、`update` 和 `run` 時必填)：要操作的觸發器識別碼；必須符合模式 `^[\w-]+$`（僅限單字字元和連字號）
- `body` (object, `create` 和 `update` 時必填；`run` 時選填)：傳送至 API 的請求負載

## 範例

### 範例 1：列出所有觸發器

```json
{
  "action": "list"
}
```

呼叫 `GET /v1/code/triggers`，傳回與已驗證帳戶相關聯的所有觸發器的 JSON 陣列。

### 範例 2：建立每個工作日早晨執行的新觸發器

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "每個工作日 UTC 08:00 產生每日摘要"
  }
}
```

使用提供的請求本文呼叫 `POST /v1/code/triggers`，傳回新建立的觸發器物件，包含其指派的 `trigger_id`。

### 範例 3：按需觸發

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

立即呼叫 `POST /v1/code/triggers/my-report-trigger/run`，略過排程時間執行。

### 範例 4：取得單一觸發器

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

呼叫 `GET /v1/code/triggers/my-report-trigger`，傳回完整的觸發器設定。

## 注意事項

- OAuth 權杖由工具在程序內注入 — 切勿手動複製、貼上或記錄權杖；這樣做會帶來安全風險，且在使用本工具時完全沒有必要。
- 對於所有觸發器 API 呼叫，請優先使用本工具而非原始 `curl` 或其他 HTTP 用戶端；直接使用 HTTP 會略過安全權杖注入，可能暴露憑證。
- 工具傳回來自 API 的原始 JSON 回應；呼叫端負責剖析回應並處理錯誤狀態碼。
- `trigger_id` 的值必須符合模式 `^[\w-]+$` — 僅允許使用字母數字字元、底線和連字號；包含空格或特殊字元將導致請求失敗。
