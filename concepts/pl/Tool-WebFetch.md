# WebFetch

## Definicja

Pobiera zawartość strony internetowej pod podanym URL, konwertuje HTML na markdown i przetwarza zawartość za pomocą modelu AI zgodnie z promptem.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `url` | string (URI) | Tak | Pełny URL do pobrania |
| `prompt` | string | Tak | Opis informacji do wyodrębnienia ze strony |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Pobieranie zawartości publicznych stron internetowych
- Przeglądanie dokumentacji online
- Wyodrębnianie określonych informacji ze stron internetowych

**Nieodpowiednie zastosowanie:**
- URL wymagające uwierzytelnienia (Google Docs, Confluence, Jira, GitHub itp.) — należy najpierw poszukać dedykowanego narzędzia MCP
- URL GitHub — preferuj użycie `gh` CLI

## Uwagi

- URL musi być pełnym, prawidłowym URL
- HTTP jest automatycznie aktualizowane do HTTPS
- Zbyt duża zawartość może zostać podsumowana
- Zawiera 15-minutowy samoczyszczący się cache
- Gdy URL przekierowuje na inny host, narzędzie zwraca URL przekierowania — należy ponowić żądanie z nowym URL
- Jeśli dostępne jest narzędzie web fetch dostarczane przez MCP, preferuj jego użycie

## Znaczenie w cc-viewer

Wywołania WebFetch w logach żądań pojawiają się jako pary bloków content `tool_use` / `tool_result`. `tool_result` zawiera podsumowanie zawartości strony przetworzone przez AI.

## Tekst oryginalny

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
