# WebSearch

## 定义

执行搜索引擎查询，返回搜索结果用于获取最新信息。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索查询（最少 2 个字符） |
| `allowed_domains` | string[] | 否 | 仅包含这些域名的结果 |
| `blocked_domains` | string[] | 否 | 排除这些域名的结果 |

## 使用场景

**适合使用：**
- 获取超出模型知识截止日期的最新信息
- 查找当前事件和最新数据
- 搜索最新的技术文档

## 注意事项

- 搜索结果以 markdown 超链接格式返回
- 使用后必须在响应末尾附上 "Sources:" 部分，列出相关 URL
- 支持域名过滤（包含/排除）
- 搜索查询中应使用当前年份
- 仅在美国可用

## 在 cc-viewer 中的意义

WebSearch 调用在请求日志中表现为 `tool_use` / `tool_result` content block 对。`tool_result` 包含搜索结果列表。

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
