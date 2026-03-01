# WebSearch

## 定義

執行搜尋引擎查詢，回傳搜尋結果用於取得最新資訊。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `query` | string | 是 | 搜尋查詢（最少 2 個字元） |
| `allowed_domains` | string[] | 否 | 僅包含這些網域的結果 |
| `blocked_domains` | string[] | 否 | 排除這些網域的結果 |

## 使用場景

**適合使用：**
- 取得超出模型知識截止日期的最新資訊
- 查找當前事件和最新資料
- 搜尋最新的技術文件

## 注意事項

- 搜尋結果以 markdown 超連結格式回傳
- 使用後必須在回應末尾附上 "Sources:" 部分，列出相關 URL
- 支援網域過濾（包含/排除）
- 搜尋查詢中應使用當前年份
- 僅在美國可用

## 在 cc-viewer 中的意義

WebSearch 呼叫在請求日誌中表現為 `tool_use` / `tool_result` content block 對。`tool_result` 包含搜尋結果列表。

## 原文

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
