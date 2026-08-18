# SearchMcpRegistry

Søker i MCP connector-registeret etter nøkkelord for å oppdage connectorer som kan bidra til å fullføre oppgaven.

## Når skal den brukes

- Oppgaven vil tjene på en ekstern tjeneste (en database, en issue tracker, en SaaS-API), og du vil sjekke om det finnes en MCP-connector for den.
- Brukeren navngir et produkt og ber om å koble det til — søk i registeret etter en matchende connector.

## Parametere

- `keywords` (array av strenger, påkrevd): Nøkkelordfraser som beskriver brukerens intensjon eller et navngitt produkt. 1–8 elementer, hver 1–64 tegn.

## Eksempler

### Eksempel 1: Finn en connector for et navngitt produkt

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Returnerer registeroppføringer hvis connectorer matcher nøkkelordene. Løs opp fullstendige connector-detaljer med `SuggestConnectors`.

## Notater

- Skrivebeskyttet og samtidighetssikker; resultatene er begrenset i størrelse.
- Kun tilgjengelig i eksterne (claude.ai) sesjoner på førsteparts-API-et.
- Søking installerer ingenting — det er ren oppdagelse.
