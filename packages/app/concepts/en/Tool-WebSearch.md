# WebSearch

Performs a live web search and returns ranked results that the assistant uses to ground its answer in current information beyond the model's training cutoff.

## When to Use

- Answering questions about current events, recent releases, or breaking news.
- Looking up the latest version of a library, framework, or CLI tool.
- Finding documentation or blog posts when the exact URL is unknown.
- Verifying a fact that may have changed since the model was trained.
- Discovering multiple perspectives on a topic before fetching any single page with `WebFetch`.

## Activation

- Availability is provider- and model-dependent: available on the Anthropic API and Claude Platform on AWS; on Microsoft Foundry it requires an Anthropic-hosted deployment; on Google Cloud it works with Claude 4+ models.
- Not available on Amazon Bedrock.
- Cap 200 calls per session with `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parameters

- `query` (string, required): The search query. Minimum length 2 characters. Include the current year when asking about "latest" or "recent" information so results are fresh.
- `allowed_domains` (array of strings, optional): Restricts results to only these domains, for example `["nodejs.org", "developer.mozilla.org"]`. Useful when you trust a specific source.
- `blocked_domains` (array of strings, optional): Excludes results from these domains. Do not pass the same domain to both `allowed_domains` and `blocked_domains`.

## Examples

### Example 1: Version lookup with current year

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Returns official announcements and avoids low-quality aggregator sites.

### Example 2: Exclude noisy sources

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Keeps results focused on vendor advisories and security trackers.

## Notes

- When you use `WebSearch` in an answer, you must append a `Sources:` section at the end of your response listing each cited result as a Markdown hyperlink of the form `[Title](URL)`. This is a hard requirement, not optional.
- `WebSearch` is only available to users in the United States. If the tool is unavailable in your region, fall back to `WebFetch` against a known URL or ask the user to paste relevant content.
- Each call performs the search in a single round-trip — you cannot stream or paginate. Refine the query if the first result set is off-target.
- The tool returns snippets and metadata, not full page contents. To read a specific hit in depth, follow up with `WebFetch` using the returned URL.
- Use `allowed_domains` to enforce authoritative sourcing for security-sensitive questions such as CVEs or compliance, and `blocked_domains` to cut out SEO farms that mirror documentation.
- Keep queries short and keyword-driven. Natural-language questions work but tend to return conversational answers rather than primary sources.
- Do not invent URLs based on search intuition — always run the search and cite what the tool actually returned.
