# SubAgent: Search

## 定義

Search 是由 Claude Code 主 agent 生成的子 agent 類型，用於執行程式碼庫搜尋。它使用 Glob、Grep 和 Read 等工具執行有針對性的檔案和內容搜尋，然後將結果返回給父 agent。

## 行為

- 當主 agent 需要搜尋或探索程式碼庫時自動生成
- 在具有唯讀存取權限的隔離上下文中執行
- 使用 Glob 進行檔案模式比對，使用 Grep 進行內容搜尋，使用 Read 進行檔案檢查
- 將搜尋結果返回給父 agent 以供進一步處理

## 出現時機

Search 子 agent 通常在以下情況出現：

1. 主 agent 需要尋找特定檔案、函式或程式碼模式時
2. 使用者請求進行廣泛的程式碼庫探索時
3. agent 正在調查依賴關係、參照或使用模式時
