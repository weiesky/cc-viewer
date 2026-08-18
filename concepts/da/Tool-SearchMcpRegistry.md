# SearchMcpRegistry

Søger i MCP-connector-registret efter nøgleord for at opdage connectors, der kan hjælpe med at fuldføre opgaven.

## Hvornår skal den bruges

- Opgaven ville drage fordel af en ekstern tjeneste (en database, en issue tracker, et SaaS-API), og du vil tjekke, om der findes en MCP-connector til den.
- Brugeren navngiver et produkt og beder om at forbinde det — søg i registret efter en matchende connector.

## Aktivering

- Kun tilgængelig i remote-sessioner (claude.ai) på first-party-API'et.

## Parametre

- `keywords` (array af strings, påkrævet): Nøgleordsfraser, der beskriver brugerens hensigt eller et navngivet produkt. 1-8 elementer, hver 1-64 tegn.

## Eksempler

### Eksempel 1: Find en connector til et navngivet produkt

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Returnerer registerposter, hvis connectors matcher nøgleordene. Opløs fulde connector-detaljer med `SuggestConnectors`.

## Noter

- Skrivebeskyttet og samtidighedssikker; resultater er begrænset i størrelse.
- Søgning installerer intet — det er ren opdagelse.
