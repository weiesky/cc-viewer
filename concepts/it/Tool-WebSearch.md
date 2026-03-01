# WebSearch

## Definizione

Esegue una query su motore di ricerca, restituendo risultati di ricerca per ottenere informazioni aggiornate.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `query` | string | Sì | Query di ricerca (minimo 2 caratteri) |
| `allowed_domains` | string[] | No | Includi solo risultati da questi domini |
| `blocked_domains` | string[] | No | Escludi risultati da questi domini |

## Scenari d'uso

**Adatto per:**
- Ottenere informazioni aggiornate oltre la data di cutoff della conoscenza del modello
- Cercare eventi attuali e dati recenti
- Cercare la documentazione tecnica più recente

## Note

- I risultati di ricerca vengono restituiti in formato hyperlink markdown
- Dopo l'uso, è obbligatorio aggiungere una sezione "Sources:" alla fine della risposta, elencando gli URL pertinenti
- Supporta il filtro per dominio (inclusione/esclusione)
- Usare l'anno corrente nelle query di ricerca
- Disponibile solo negli Stati Uniti

## Significato in cc-viewer

Le chiamate WebSearch appaiono nei log delle richieste come coppie di content block `tool_use` / `tool_result`. Il `tool_result` contiene la lista dei risultati di ricerca.

## Testo originale

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
