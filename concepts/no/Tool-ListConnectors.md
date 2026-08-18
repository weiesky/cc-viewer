# ListConnectors

Lister MCP-connector-ene installert for brukerens claude.ai-organisasjon, eventuelt filtrert etter nøkkelord.

## Når skal den brukes

- Du må vite hvilke connectorer som allerede er installert før du foreslår nye.
- Brukeren spør hvilke integrasjoner organisasjonen deres har.

## Aktivering

- Kun tilgjengelig i eksterne (claude.ai) sesjoner på førsteparts-API-et.

## Parametere

- `keywords` (array av strenger, valgfri): Filtrer listen — opptil 8 elementer, hver 1–64 tegn. Utelat for å liste alt.

## Eksempler

### Eksempel 1: List alle installerte connectorer

```
ListConnectors()
```

### Eksempel 2: Filtrer etter nøkkelord

```
ListConnectors(keywords=["github"])
```

## Notater

- Par med `SearchMcpRegistry` (oppdagelse) og `SuggestConnectors` (detaljer) for den fullstendige finn-og-aktiver-flyten.
