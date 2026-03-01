# WebSearch

## Definicja

Wykonuje zapytanie do wyszukiwarki, zwracając wyniki wyszukiwania w celu uzyskania aktualnych informacji.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `query` | string | Tak | Zapytanie wyszukiwania (minimum 2 znaki) |
| `allowed_domains` | string[] | Nie | Uwzględnij tylko wyniki z tych domen |
| `blocked_domains` | string[] | Nie | Wyklucz wyniki z tych domen |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Uzyskiwanie najnowszych informacji wykraczających poza datę odcięcia wiedzy modelu
- Wyszukiwanie bieżących wydarzeń i najnowszych danych
- Wyszukiwanie najnowszej dokumentacji technicznej

## Uwagi

- Wyniki wyszukiwania są zwracane w formacie hiperłączy markdown
- Po użyciu należy dołączyć sekcję "Sources:" na końcu odpowiedzi z listą odpowiednich URL
- Obsługuje filtrowanie domen (uwzględnianie/wykluczanie)
- W zapytaniach wyszukiwania należy używać bieżącego roku
- Dostępne tylko w USA

## Znaczenie w cc-viewer

Wywołania WebSearch w logach żądań pojawiają się jako pary bloków content `tool_use` / `tool_result`. `tool_result` zawiera listę wyników wyszukiwania.

## Tekst oryginalny

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
