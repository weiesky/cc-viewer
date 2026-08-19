# ListConnectors

Lister de MCP-connectors, der er installeret til brugerens claude.ai-organisation, eventuelt filtreret efter nøgleord.

## Hvornår skal den bruges

- Du har brug for at vide, hvilke connectors der allerede er installeret, før du foreslår nye.
- Brugeren spørger, hvilke integrationer deres organisation har.

## Aktivering

- Kun tilgængelig i remote-sessioner (claude.ai) på first-party-API'et.

## Parametre

- `keywords` (array af strings, valgfri): Filtrer listen — op til 8 elementer, hver 1-64 tegn. Udelad for at liste alt.

## Eksempler

### Eksempel 1: List alle installerede connectors

```
ListConnectors()
```

### Eksempel 2: Filtrer efter nøgleord

```
ListConnectors(keywords=["github"])
```

## Noter

- Par med `SearchMcpRegistry` (opdagelse) og `SuggestConnectors` (detaljer) for hele find-og-aktivér-forløbet.
