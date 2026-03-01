# WebSearch

## Definition

Führt eine Suchmaschinenabfrage durch und gibt Suchergebnisse zurück, um aktuelle Informationen zu erhalten.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `query` | string | Ja | Suchanfrage (mindestens 2 Zeichen) |
| `allowed_domains` | string[] | Nein | Nur Ergebnisse von diesen Domains einschließen |
| `blocked_domains` | string[] | Nein | Ergebnisse von diesen Domains ausschließen |

## Anwendungsfälle

**Geeignet für:**
- Aktuelle Informationen abrufen, die über den Wissensstand des Modells hinausgehen
- Aktuelle Ereignisse und neueste Daten finden
- Neueste technische Dokumentation suchen

## Hinweise

- Suchergebnisse werden im Markdown-Hyperlink-Format zurückgegeben
- Nach der Verwendung muss am Ende der Antwort ein "Sources:"-Abschnitt mit den relevanten URLs angefügt werden
- Unterstützt Domain-Filterung (einschließen/ausschließen)
- In Suchanfragen sollte das aktuelle Jahr verwendet werden
- Nur in den USA verfügbar

## Bedeutung in cc-viewer

WebSearch-Aufrufe erscheinen im Anfrage-Log als `tool_use` / `tool_result` Content-Block-Paare. `tool_result` enthält die Liste der Suchergebnisse.

## Originaltext

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
