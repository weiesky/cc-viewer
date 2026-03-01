# WebSearch

## Definition

Performs search engine queries and returns search results for obtaining up-to-date information.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (minimum 2 characters) |
| `allowed_domains` | string[] | No | Only include results from these domains |
| `blocked_domains` | string[] | No | Exclude results from these domains |

## Use Cases

**Good for:**
- Getting the latest information beyond the model's knowledge cutoff date
- Finding current events and recent data
- Searching for the latest technical documentation

## Notes

- Search results are returned in markdown hyperlink format
- After using this tool, a "Sources:" section must be appended at the end of the response listing the relevant URLs
- Supports domain filtering (include/exclude)
- Use the current year in search queries
- Only available in the US

## Significance in cc-viewer

WebSearch calls appear in request logs as `tool_use` / `tool_result` content block pairs. The `tool_result` contains the search results list.

## Original Text

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
