# Translate API Context Pollution

## Background

CC-Viewer includes a built-in translation feature (`POST /api/translate`) powered by the Anthropic Messages API. In the early implementation, translation requests reused cached authentication credentials from the Claude Code session — including both `x-api-key` and `authorization` headers. This caused a subtle but serious issue: translation results frequently returned irrelevant content.

## Root Cause

### Fundamental Difference Between Two Authentication Methods

The Anthropic API supports two authentication methods:

| Method | Header | Typical Source | Characteristics |
|--------|--------|----------------|-----------------|
| API Key | `x-api-key: sk-ant-...` | Environment variable / Console | Stateless, each request is independent |
| OAuth Token | `authorization: Bearer sessionToken` | Claude Code subscription login | Session-bound, server maintains context association |

The key difference: **API Keys are stateless** — each request is completely independent; while **OAuth session tokens are stateful** — the Anthropic server associates requests using the same token to the same session context.

### Pollution Chain

When Claude Code uses subscription OAuth login, the authentication flow looks like:

```
Claude Code main conversation ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                          ↑
CC-Viewer translate request ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Since translation requests reused the same session token, the Anthropic server may associate translation requests with Claude Code's main conversation context. This causes:

1. **Translation results influenced by main conversation context**: The translation request's system prompt is "you are a translator", but the server context still contains Claude Code's conversation history, potentially interfering with the model
2. **Main conversation disturbed by translation requests**: Translation request content (UI text fragments) may be injected into the main conversation context, causing Claude Code's responses to deviate
3. **Unpredictable behavior**: Since context pollution is server-side behavior, the client cannot detect or control it

## Lessons Learned

- **OAuth session tokens are not "just another API Key"** — they carry server-side state, reusing them means sharing context
- **Internal service calls should use independent, stateless authentication** to avoid association with user sessions

## References

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started) — Official documentation on `x-api-key` and `authorization` headers
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code) — API Key environment variable management
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/) — Anthropic's restrictions on OAuth token usage scope
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/) — Authentication method comparison
