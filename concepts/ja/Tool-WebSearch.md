# WebSearch

## 定義

検索エンジンクエリを実行し、最新情報を取得するための検索結果を返します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `query` | string | はい | 検索クエリ（最低2文字） |
| `allowed_domains` | string[] | いいえ | これらのドメインの結果のみを含む |
| `blocked_domains` | string[] | いいえ | これらのドメインの結果を除外 |

## 使用シナリオ

**適している場合：**
- モデルの知識カットオフ日を超えた最新情報の取得
- 現在のイベントや最新データの検索
- 最新の技術ドキュメントの検索

## 注意事項

- 検索結果は markdown ハイパーリンク形式で返される
- 使用後はレスポンスの末尾に "Sources:" セクションを付け、関連 URL を列挙する必要がある
- ドメインフィルタリング（包含/除外）に対応
- 検索クエリには現在の年を使用すべき
- 米国でのみ利用可能

## cc-viewer での意義

WebSearch 呼び出しはリクエストログで `tool_use` / `tool_result` content block ペアとして表示されます。`tool_result` には検索結果リストが含まれます。

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
