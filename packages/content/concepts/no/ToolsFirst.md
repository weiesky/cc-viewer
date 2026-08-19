# Hvorfor vises Tools først?

I cc-viewers kontekstpanel vises **Tools før System Prompt og Messages**. Denne rekkefølgen gjenspeiler nøyaktig **Anthropic API-ens KV-Cache-prefiks-sekvens**.

## KV-Cache-prefiks-sekvens

Når Anthropic's API bygger opp KV-Cache, setter den sammen konteksten til et prefiks i denne **faste rekkefølgen**:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Dette betyr at **Tools befinner seg før System Prompt helt i begynnelsen av cache-prefikset**.

## Hvorfor har Tools høyere cache-vekt enn System?

Ved KV-Cache-prefiksmatchning er **tidlig innhold mer kritisk** — enhver endring ugyldiggjør alt som kommer etter:

1. **Prefiksmatchning starter fra begynnelsen**: KV-Cache sammenligner den gjeldende forespørselen med det bufrede prefikset token for token fra starten. I det øyeblikket et avvik oppdages, ugyldiggjøres alt etterfølgende innhold.

2. **Tools endres = hele cachen ugyldiggjøres**: Siden Tools kommer først, vil enhver endring i verktøydefinisjoner (selv å legge til eller fjerne ett enkelt MCP-tool) **bryte prefikset helt fra starten**, og ugyldiggjøre all bufret System Prompt og Messages.

3. **System endres = Messages-cache ugyldiggjøres**: System Prompt befinner seg i midten, så dens endringer ugyldiggjør bare den etterfølgende Messages-delen.

4. **Messages endres = bare halen påvirkes**: Messages er på slutten, så å legge til nye meldinger ugyldiggjør bare et lite avsluttende segment — cache for Tools og System forblir intakt.

## Praktisk betydning

| Endringstype | Cache-påvirkning | Typisk scenario |
|--------------|-----------------|-----------------|
| Tool lagt til/fjernet | **Full ugyldiggjøring** | MCP server tilkobling/frakobling, IDE-plugin av/på |
| System Prompt-endring | Messages-cache tapt | CLAUDE.md-redigering, system reminder-injeksjon |
| Ny melding lagt til | Bare hale-inkrement | Normal samtaleflyt (vanligst, billigst) |

Dette er grunnen til at `tools_change` i [CacheRebuild](CacheRebuild.md) typisk er den dyreste gjenoppbyggingsårsaken — den bryter prefikskjeden helt fremst.

## Hvorfor plasseres verktøydefinisjoner før "hjernen"?

Fra et caching-perspektiv er det et teknisk faktum at Tools kommer først. Men fra et kognitivt designperspektiv er denne rekkefølgen like logisk — **Tools er hender og føtter, System Prompt er hjernen**.

Før man handler, må man oppfatte hvilke lemmer og verktøy man har tilgjengelig. Et spedbarn forstår ikke først reglene i verden (System) for så å lære å gripe — det oppfatter først at det har hender og føtter, og forstår gradvis reglene gjennom samspill med omgivelsene. På samme måte må en LLM vite hvilke verktøy den kan kalle (lese filer, skrive kode, søke, utføre kommandoer) før den mottar oppgaveinstruksjoner (System Prompt), slik at den nøyaktig kan vurdere "hva kan jeg gjøre" og "hvordan bør jeg gjøre det" ved behandling av instruksjonene.

Hvis det var omvendt — først fortelle modellen "oppgaven din er å refaktorere denne modulen", deretter "du har Read, Edit, Bash-verktøy" — ville modellen mangle kritisk informasjon om sine kapabilitetsgrenser ved forståelse av oppgaven, noe som potensielt kunne føre til urealistiske planer eller overseing av tilgjengelige tilnærminger.

**Kjenn kortene dine før du bestemmer deg for hvordan du spiller.** Dette er den kognitive logikken bak at Tools plasseres før System.

## Hvorfor er MCP-verktøy også på denne posisjonen?

MCP-verktøy (Model Context Protocol) plasseres, som innebygde verktøy, helt i starten av Tools-området. Å forstå MCPs posisjon i konteksten hjelper med å vurdere de reelle fordelene og kostnadene.

### MCP-fordeler

- **Kapabilitetsutvidelse**: MCP lar modeller tilgå eksterne tjenester (databasespørringer, API-kall, IDE-operasjoner, nettleserstyring osv.), og overskrider grensene for innebygde verktøy
- **Åpent økosystem**: Hvem som helst kan implementere en MCP-server; modellen oppnår nye kapabiliteter uten re-trening
- **On-demand-lasting**: MCP-servere kan selektivt kobles til/fra etter oppgavescenario, med fleksibel sammensetning av verktøysett

### MCP-kostnader

- **Cache-dreper**: Hvert MCP-verktøys JSON Schema-definisjon sammenkjedes i starten av KV-Cache-prefikset. Tillegg eller fjerning av ett MCP-verktøy = **hele cachen invalidert fra starten**. Hyppig tilkobling/frakobling av MCP-servere reduserer cache-treffraten drastisk
- **Prefiks-oppblåsing**: MCP-verktøyers Schemas er typisk større enn innebygde verktøy (detaljerte parameterbeskrivelser, enum-verdier osv.). Mange MCP-verktøy øker token-antallet i Tools-området betydelig og innsnevrer kontekstrommet for Messages
- **Latens-overhead**: MCP-verktøykall krever inter-prosesskommunikasjon (JSON-RPC over stdio/SSE), en størrelsesorden tregere enn innebygde funksjonskall
- **Stabilitetsrisiko**: MCP-servere er eksterne prosesser som kan krasje, time ut eller returnere uventede formater, og krever ekstra feilhåndtering

### Praktiske anbefalinger

| Scenario | Anbefaling |
|----------|-----------|
| Lange samtaler, hyppig interaksjon | Minimér antallet MCP-verktøy for å beskytte cache-prefiks-stabiliteten |
| Korte oppgaver, engangsoperasjoner | Bruk MCP-verktøy fritt; cache-påvirkningen er begrenset |
| Hyppig tillegg/fjerning av MCP-servere | Hver endring utløser full cache-gjenoppbygging; vurder å fastlåse verktøysettet |
| Overdimensjonerte Tool Schemas | Beskjær beskrivelser og enums for å redusere prefiks-tokenforbruk |

I cc-viewers Context-panel vises MCP-verktøy sammen med innebygde verktøy i Tools-området, noe som gir et klart overblikk over hvert verktøys Schema-størrelse og bidrag til cache-prefikset.
