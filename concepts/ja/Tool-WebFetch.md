# WebFetch

## 定義

指定 URL のウェブページ内容を取得し、HTML を markdown に変換し、AI モデルで prompt に基づいて内容を処理します。

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|------------|------|------|------|
| `url` | string (URI) | はい | 取得する完全な URL |
| `prompt` | string | はい | ページからどの情報を抽出するかの説明 |

## 使用シナリオ

**適している場合：**
- 公開ウェブページの内容を取得
- オンラインドキュメントの参照
- ウェブページから特定の情報を抽出

**適していない場合：**
- 認証が必要な URL（Google Docs、Confluence、Jira、GitHub など）——まず専用の MCP ツールを探すべき
- GitHub URL——`gh` CLI を優先使用

## 注意事項

- URL は完全な有効 URL でなければならない
- HTTP は自動的に HTTPS にアップグレード
- 内容が大きすぎる場合、結果が要約される可能性がある
- 15分の自動クリーニングキャッシュを含む
- URL が異なるホストにリダイレクトされた場合、ツールはリダイレクト URL を返し、新しい URL で再リクエストが必要
- MCP 提供の web fetch ツールが利用可能な場合、そちらを優先使用

## cc-viewer での意義

WebFetch 呼び出しはリクエストログで `tool_use` / `tool_result` content block ペアとして表示されます。`tool_result` には AI 処理後のウェブページ内容の要約が含まれます。

## 原文

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
