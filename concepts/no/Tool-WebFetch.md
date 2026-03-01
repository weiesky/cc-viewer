# WebFetch

## Definisjon

Henter innhold fra en spesifisert URL, konverterer HTML til markdown og behandler innholdet med en AI-modell basert på promptet.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `url` | string (URI) | Ja | Fullstendig URL som skal hentes |
| `prompt` | string | Ja | Beskrivelse av hvilken informasjon som skal trekkes ut fra siden |

## Bruksscenarioer

**Egnet for bruk:**
- Hente innhold fra offentlige nettsider
- Slå opp nettbasert dokumentasjon
- Trekke ut spesifikk informasjon fra nettsider

**Ikke egnet for bruk:**
- URL-er som krever autentisering (Google Docs, Confluence, Jira, GitHub osv.) — søk først etter et dedikert MCP-verktøy
- GitHub-URL-er — foretrekk `gh` CLI

## Merknader

- URL-en må være en fullstendig gyldig URL
- HTTP oppgraderes automatisk til HTTPS
- Resultater kan bli oppsummert når innholdet er for stort
- Inkluderer en selvrensende 15-minutters cache
- Når URL-en omdirigerer til en annen vert, returnerer verktøyet den omdirigerte URL-en, og du må sende en ny forespørsel med den nye URL-en
- Hvis et MCP-levert web fetch-verktøy er tilgjengelig, foretrekk det

## Betydning i cc-viewer

WebFetch-kall vises i forespørselsloggen som et par av `tool_use` / `tool_result` content blocks. `tool_result` inneholder AI-behandlet sammendrag av nettsideinnholdet.

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
