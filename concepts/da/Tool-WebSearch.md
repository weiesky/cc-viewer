# WebSearch

## Definition

Udfører en søgemaskineforespørgsel og returnerer søgeresultater til at hente aktuel information.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `query` | string | Ja | Søgeforespørgsel (mindst 2 tegn) |
| `allowed_domains` | string[] | Nej | Inkluder kun resultater fra disse domæner |
| `blocked_domains` | string[] | Nej | Ekskluder resultater fra disse domæner |

## Brugsscenarier

**Egnet til:**
- Hente aktuel information ud over modellens videns-cutoff-dato
- Søge efter aktuelle begivenheder og nyeste data
- Søge efter den nyeste tekniske dokumentation

## Bemærkninger

- Søgeresultater returneres i markdown-hyperlinkformat
- Efter brug skal der tilføjes en "Sources:"-sektion i slutningen af svaret med relevante URL'er
- Understøtter domænefiltrering (inklusion/eksklusion)
- Brug det aktuelle år i søgeforespørgsler
- Kun tilgængelig i USA

## Betydning i cc-viewer

WebSearch-kald vises i requestloggen som `tool_use` / `tool_result` content block-par. `tool_result` indeholder listen over søgeresultater.

## Originaltekst

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
