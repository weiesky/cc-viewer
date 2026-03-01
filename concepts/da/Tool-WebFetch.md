# WebFetch

## Definition

Henter indholdet af en webside fra den angivne URL, konverterer HTML til markdown og behandler indholdet med en AI-model baseret på prompten.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `url` | string (URI) | Ja | Komplet URL der skal hentes |
| `prompt` | string | Ja | Beskriver hvilken information der skal udtrækkes fra siden |

## Brugsscenarier

**Egnet til:**
- Hente indhold fra offentlige websider
- Slå op i onlinedokumentation
- Udtrække specifik information fra en webside

**Ikke egnet til:**
- URL'er der kræver autentificering (Google Docs, Confluence, Jira, GitHub osv.) — søg først efter et dedikeret MCP-værktøj
- GitHub-URL'er — foretræk brug af `gh` CLI

## Bemærkninger

- URL'en skal være en komplet gyldig URL
- HTTP opgraderes automatisk til HTTPS
- Resultater kan blive opsummeret, hvis indholdet er for stort
- Inkluderer en selvrensende 15-minutters cache
- Når URL'en omdirigerer til en anden vært, returnerer værktøjet omdirigerings-URL'en, og der skal foretages en ny anmodning med den nye URL
- Hvis et MCP-leveret web fetch-værktøj er tilgængeligt, foretræk det

## Betydning i cc-viewer

WebFetch-kald vises i requestloggen som `tool_use` / `tool_result` content block-par. `tool_result` indeholder det AI-behandlede resumé af webindholdet.

## Originaltekst

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
