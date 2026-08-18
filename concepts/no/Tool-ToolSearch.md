# ToolSearch

Henter ved behov de fullstendige schema-definisjonene for "utsatte verktøy" slik at de blir kallbare. Når mange verktøy er tilgjengelige, lastes noen ikke inn på forhånd — de vises kun ved navn inne i `<system-reminder>`-meldinger. Inntil schemaet er hentet, er bare navnet kjent og det finnes ingen parameterdefinisjon, så verktøyet kan ikke invokeres. `ToolSearch` tar en forespørsel, matcher den mot listen over utsatte verktøy og returnerer de matchede verktøyenes fullstendige JSONSchema-definisjoner inne i en `<functions>`-blokk. Så snart et verktøys schema vises i resultatet, kan det kalles akkurat som ethvert verktøy definert øverst i prompten.

## Når skal den brukes

- Du trenger et utsatt verktøy — navnet dets vises i en `<system-reminder>`, men det finnes ingen parameterdefinisjon for det i verktøylisten på øverste nivå.
- Du vil bruke verktøyene til en MCP-server (f.eks. Slack, Gmail, computer-use) som lastes inn ved behov.
- Du er ikke sikker på det eksakte verktøynavnet for en kapasitet og vil hente fram kandidater etter nøkkelord i én operasjon.

Hvis et verktøys schema allerede er i konteksten, søk ikke igjen — bare kall det.

## Aktivering

- På som standard.
- Av når `ANTHROPIC_BASE_URL` peker mot et ikke-Anthropic-endepunkt (med mindre `ENABLE_TOOL_SEARCH` er satt), når `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` er satt, når modellen mangler verktøyreferansestøtte (Vertex AI-modeller før Claude 4.5), eller når nektet via `"deny": ["ToolSearch"]`.

## Parametere

- `query` (string, påkrevd): Forespørselen som brukes til å lokalisere utsatte verktøy. Tre former støttes:
  - `select:Read,Edit,Grep` — henter disse eksakte verktøyene ved navn.
  - `notebook jupyter` — nøkkelordsøk som returnerer opptil `max_results` beste treff.
  - `+slack send` — krever at `slack` vises i verktøynavnet, og rangerer deretter etter de gjenværende termene.
- `max_results` (number, valgfri): Maksimalt antall resultater som returneres. Standard er 5.

## Eksempler

### Eksempel 1: Hent ved eksakt navn

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Eksempel 2: Nøkkelordsøk

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Eksempel 3: Last inn et helt MCP-verktøysett på én gang

Når du masselaster alle verktøy fra en MCP-server (f.eks. computer-use), bruk ett enkelt nøkkelordsøk i stedet for å velge hvert enkelt — servernavnet som delstreng matcher alle verktøy under den serveren:

```
ToolSearch(query="computer-use", max_results=30)
```

## Notater

- Før du invokerer et utsatt verktøy må du først hente schemaet dets med `ToolSearch` — å kalle det direkte feiler fordi parameterdefinisjonen mangler.
- Når du masselaster et helt verktøysett (f.eks. alle verktøyene til en MCP-server), foretrekk ett nøkkelordsøk fremfor mange `select:`-kall for å kutte ned på frem og tilbake.
- Så snart et schema er hentet, oppfører verktøyet seg akkurat som ethvert vanlig verktøy; søk ikke etter det samme verktøyet igjen.
- Resultatene kommer tilbake som en `<functions>`-blokk, hvert verktøy en enkelt `<function>{...}</function>`-linje — den samme kodingen som verktøylisten på øverste nivå.
