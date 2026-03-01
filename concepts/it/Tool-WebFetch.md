# WebFetch

## Definizione

Recupera il contenuto di una pagina web dall'URL specificato, converte l'HTML in markdown e lo elabora con un modello AI in base al prompt.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `url` | string (URI) | Sì | URL completo da recuperare |
| `prompt` | string | Sì | Descrive quali informazioni estrarre dalla pagina |

## Scenari d'uso

**Adatto per:**
- Ottenere il contenuto di pagine web pubbliche
- Consultare documentazione online
- Estrarre informazioni specifiche da una pagina web

**Non adatto per:**
- URL che richiedono autenticazione (Google Docs, Confluence, Jira, GitHub, ecc.) — cercare prima uno strumento MCP dedicato
- URL di GitHub — preferire l'uso della CLI `gh`

## Note

- L'URL deve essere un URL valido e completo
- HTTP viene automaticamente aggiornato a HTTPS
- I risultati possono essere riassunti se il contenuto è troppo grande
- Include una cache auto-pulente di 15 minuti
- Quando l'URL reindirizza a un host diverso, lo strumento restituisce l'URL di reindirizzamento e occorre effettuare una nuova richiesta con il nuovo URL
- Se è disponibile uno strumento web fetch fornito da MCP, preferire quello

## Significato in cc-viewer

Le chiamate WebFetch appaiono nei log delle richieste come coppie di content block `tool_use` / `tool_result`. Il `tool_result` contiene il riepilogo del contenuto web elaborato dall'AI.

## Testo originale

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
