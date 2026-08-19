# Artifact

Render an HTML or Markdown file to an Artifact — a default-private web page hosted on claude.ai that the user can open in a browser and later choose to share. Use it when communicating visually beats terminal text.

## When to Use

- Publishing a visual deliverable: a report, dashboard, bug investigation write-up, or UI mockup
- Updating a previously published page in place (same file path redeploys to the same URL)
- Listing the user's existing artifacts to find one from an earlier session (`action: "list"`)
- **Not** for content that must stay local, plain-text answers, or anything needing external network resources at view time — a strict CSP blocks every external host

## Activation

- Requires a Pro, Max, Team, or Enterprise plan with claude.ai login (`/login`).
- Anthropic API only — not available on Amazon Bedrock, Google Cloud, or Microsoft Foundry.
- Requires Claude Code ≥ 2.1.183 or the Desktop app ≥ 1.13576.0.
- Disable with the `disableArtifact` setting or `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parameters

- `file_path` (string): Path to the `.html` or `.md` file to render. The file is wrapped in a document skeleton at publish time, so write page content directly — no `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>` tags. Same path → same URL on redeploy; a different path claims a new URL.
- `favicon` (string, required to publish): One or two emoji used as the browser-tab icon (e.g. `"📊"`). Emoji only, no markup. Keep it the same across redeploys — users find their tab by its icon.
- `description` (string): One-sentence subtitle shown on the artifact gallery card.
- `url` (string, optional): Pass an existing artifact's URL to update it in place from a conversation that did not publish it. Without it, a new conversation always mints a new URL.
- `label` (string, optional): Short human-readable version name (max 60 chars) shown in the version picker.
- `action` (string, optional): `"publish"` (default) or `"list"` — enumerate the user's published artifacts (title, URL, last-updated), optionally with `limit`.
- `force` (boolean, optional): Overwrite without a conflict check. Only after a 409 from a concurrent write, once reconciled.

## Notes

- **Self-contained only.** A strict CSP blocks requests to any external host — CDN scripts, external stylesheets, remote images, fetch/WebSockets. Inline all CSS/JS and embed assets as `data:` URIs.
- **Responsive and theme-aware.** Pages render in the viewer's light or dark theme; style both (`prefers-color-scheme` plus the viewer's `data-theme` override). Wide content scrolls inside its own container — the page body must never scroll horizontally.
- **Updating across conversations needs `url`.** Redeploying the same file path only reuses the URL within the conversation that published it; to keep an older artifact's link, find its URL with `action: "list"` and pass it as `url`.
- **Publishing is outward-facing.** Content sent to the artifact service may be cached even if deleted later — don't publish anything that must stay private to the machine.
- **Read back with WebFetch.** claude.ai artifact URLs are fetchable via WebFetch (not curl, which gets the app shell).
