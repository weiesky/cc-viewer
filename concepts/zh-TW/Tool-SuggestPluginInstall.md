# SuggestPluginInstall

從 `SearchPlugins` 結果渲染內聯外掛安裝卡片，將外掛建議與使用者的請求連結。

## 使用時機

- 外掛搜尋浮現了符合使用者正嘗試之事的外掛，而你想提供它們以供安裝。

## 啟用方式

- 僅在已連線 Remote Control 用戶端，或工作階段執行於受管理的雲端環境時。
- 在 HIPAA 企業設定下停用。
- brief 模式中不提供。

## 參數

- `contextLabel`（string，必填）：將建議連結至使用者請求的簡短標題（最多 128 個字元）。
- `plugins`（array，必填）：取自 `SearchPlugins` 結果的外掛——1–16 個條目，每個包含：
  - `pluginId`（string，必填）
  - `pluginName`（string，必填）
  - `description`（string，必填）
  - `skills`（array，選填）：最多 32 個 `{name, description?}` 條目，描述該外掛的 skills。

## 範例

### 範例 1：提供相符的外掛

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

卡片會為使用者渲染；啟用外掛是在頻帶外進行。後續呼叫 `ListPlugins` 以探索實際安裝了什麼。

## 注意事項

- 只包含來自搜尋結果的外掛——絕不憑空捏造外掛條目。
