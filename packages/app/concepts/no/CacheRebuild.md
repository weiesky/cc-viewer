# Cache Rebuild (cache-gjenoppbygging)

## Bakgrunn

Anthropics prompt caching-mekanisme setter sammen system → tools → messages (til cache-brytepunktet) i rekkefølge som cache-nøkkel. Når cache-nøkkelen er helt identisk med forrige forespørsel, returnerer API-et `cache_read_input_tokens` (cache-treff); når nøkkelen endres, oppretter API-et cachen på nytt og returnerer en stor mengde `cache_creation_input_tokens`, altså cache-gjenoppbygging.

Cache-gjenoppbygging betyr ekstra token-kostnader (prisen for cache creation er høyere enn cache read), så å identifisere årsaken til gjenoppbygging har direkte verdi for kostnadsoptimalisering.

## Klassifisering av årsaker til cache-gjenoppbygging

cc-viewer bestemmer nøyaktig årsaken til cache-gjenoppbygging ved å sammenligne body fra to påfølgende MainAgent-forespørsler:

| reason | Betydning | Bestemmelsesmetode |
|--------|-----------|-------------------|
| `ttl` | Cache utløpt | Mer enn 5 minutter siden forrige MainAgent-forespørsel |
| `system_change` | System prompt endret | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Verktøydefinisjoner endret | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Modellbytte | `prev.model !== curr.model` |
| `msg_truncated` | Meldingsstakk avkortet | Gjeldende forespørsel har færre meldinger enn forrige, vanligvis utløst av kontekstvindu-overflyt |
| `msg_modified` | Historiske meldinger endret | Prefiks-meldingsinnhold stemmer ikke overens (ved normal tillegging skal prefikset være helt identisk) |
| `key_change` | Ukjent nøkkelendring | Fallback når ingen av betingelsene ovenfor matcher |

## Prioriteringsrekkefølge

1. Sjekk tidsintervall først — over 5 minutter gir direkte `ttl`-bestemmelse uten body-sammenligning
2. Deretter sjekkes model, system, tools og messages i rekkefølge
3. En forespørsel kan matche flere årsaker samtidig (f.eks. modellbytte + system prompt-endring), da inneholder `reasons`-arrayen alle matchende elementer og tooltip vises med flere linjer

## Vanlige scenarioer

- **`ttl`**: Brukeren pauset i mer enn 5 minutter og fortsatte deretter, cachen utløp naturlig
- **`system_change`**: Claude Code oppdaterte system prompt (f.eks. lastet ny CLAUDE.md eller endring i prosjektinstruksjoner)
- **`tools_change`**: MCP-server tilkobling/frakobling førte til endring i tilgjengelig verktøyliste
- **`model_change`**: Brukeren byttet modell via `/model`-kommandoen
- **`msg_truncated`**: Lang samtale utløste kontekstvindu-håndtering, Claude Code avkortet tidlige meldinger
- **`msg_modified`**: Claude Code redigerte historiske meldinger (f.eks. `/compact` komprimeringssammendrag erstattet originale meldinger)
