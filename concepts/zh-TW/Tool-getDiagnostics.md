# getDiagnostics (mcp__ide__getDiagnostics)

## 定義

從 VS Code 取得語言診斷資訊，包括語法錯誤、型別錯誤、lint 警告等。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `uri` | string | 否 | 檔案 URI。不提供則取得所有檔案的診斷資訊 |

## 使用場景

**適合使用：**
- 檢查程式碼的語法、型別、lint 等語義問題
- 編輯程式碼後驗證是否引入了新錯誤
- 替代 Bash 命令來檢查程式碼品質

**不適合使用：**
- 執行測試——應使用 Bash
- 檢查執行時錯誤——應使用 Bash 執行程式碼

## 注意事項

- 這是一個 MCP（Model Context Protocol）工具，由 IDE 整合提供
- 僅在 VS Code / IDE 環境中可用
- 優先使用此工具而非 Bash 命令來檢查程式碼問題

## 原文

<textarea readonly>Get language diagnostics from VS Code</textarea>
