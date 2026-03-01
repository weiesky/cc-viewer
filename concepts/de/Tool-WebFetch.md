# WebFetch

## Definition

Ruft den Inhalt einer angegebenen URL ab, konvertiert HTML in Markdown und verarbeitet den Inhalt mit einem KI-Modell basierend auf dem Prompt.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `url` | string (URI) | Ja | Die vollständige abzurufende URL |
| `prompt` | string | Ja | Beschreibt, welche Informationen von der Seite extrahiert werden sollen |

## Anwendungsfälle

**Geeignet für:**
- Inhalte öffentlicher Webseiten abrufen
- Online-Dokumentation nachschlagen
- Bestimmte Informationen aus Webseiten extrahieren

**Nicht geeignet für:**
- URLs, die Authentifizierung erfordern (Google Docs, Confluence, Jira, GitHub usw.) – zuerst nach einem dedizierten MCP-Tool suchen
- GitHub-URLs – bevorzugt `gh` CLI verwenden

## Hinweise

- Die URL muss eine vollständige gültige URL sein
- HTTP wird automatisch auf HTTPS hochgestuft
- Bei sehr großen Inhalten können die Ergebnisse zusammengefasst werden
- Enthält einen sich selbst bereinigenden 15-Minuten-Cache
- Wenn die URL zu einem anderen Host weiterleitet, gibt das Tool die Weiterleitungs-URL zurück; eine erneute Anfrage mit der neuen URL ist erforderlich
- Wenn ein MCP-bereitgestelltes Web-Fetch-Tool verfügbar ist, dieses bevorzugt verwenden

## Bedeutung in cc-viewer

WebFetch-Aufrufe erscheinen im Anfrage-Log als `tool_use` / `tool_result` Content-Block-Paare. `tool_result` enthält die KI-verarbeitete Zusammenfassung des Webseiteninhalts.

## Originaltext

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
