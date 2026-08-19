# WebFetch

Retrieves the contents of a public web page, converts the HTML to Markdown, and runs a small auxiliary model over the result using a natural-language prompt to extract the information you need.

## When to Use

- Reading a public documentation page, blog post, or RFC referenced in the conversation.
- Extracting a specific fact, code snippet, or table from a known URL without loading the full page into context.
- Summarizing release notes or changelogs from an open web resource.
- Checking a library's public API reference when the source is not in the local repository.
- Following a link the user pasted into chat to answer a follow-up question.

## Parameters

- `url` (string, required): A fully-formed absolute URL. Plain `http://` is automatically upgraded to `https://`.
- `prompt` (string, required): The instruction passed to the small extraction model. Describe exactly what to pull out of the page, such as "list all exported functions" or "return the minimum supported Node version".

## Examples

### Example 1: Extract a configuration default

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

The tool fetches the Vite docs page, converts it to Markdown, and returns a short answer such as "Default is `5173`; accepts a number only."

### Example 2: Summarize a changelog section

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Useful when the user asks "what changed in Node 20.11" and the release page is long.

## Notes

- `WebFetch` fails on any URL that requires authentication, cookies, or a VPN. For Google Docs, Confluence, Jira, private GitHub resources, or internal wikis, use a dedicated MCP server that provides authenticated access instead.
- For anything hosted on GitHub (PRs, issues, file blobs, API responses), prefer the `gh` CLI through `Bash` rather than scraping the web UI. `gh pr view`, `gh issue view`, and `gh api` return structured data and work against private repositories.
- Results may be summarized when the fetched page is very large. If you need exact text, narrow the `prompt` to ask for a literal extract.
- A self-cleaning 15-minute cache is applied per URL. Repeated calls to the same page during one session are near-instant but may return slightly stale content. If freshness matters, mention that in the prompt or wait out the cache.
- If the target host issues a cross-host redirect, the tool returns the new URL in a special response block and does not follow it automatically. Re-invoke `WebFetch` with the redirect target if you still want the content.
- The prompt is executed by a smaller, faster model than the main assistant. Keep it narrow and concrete; complex multi-step reasoning is better handled by reading the raw Markdown yourself after fetching.
- Never pass secrets, tokens, or session identifiers embedded in the URL — page contents and query strings reflected in output may be logged by upstream services.
