# Hvorfor vises Tools først?

I cc-viewers kontekstpanel vises **Tools før System Prompt og Messages**. Denne rækkefølge afspejler præcist **Anthropic API's KV-Cache-præfikssekvens**.

## KV-Cache-præfikssekvens

Når Anthropic's API opbygger KV-Cache, sammensætter den konteksten til et præfiks i denne **faste rækkefølge**:

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Det betyder, at **Tools befinder sig før System Prompt helt i begyndelsen af cache-præfikset**.

## Hvorfor har Tools større cache-vægt end System?

Ved KV-Cache-præfiksmatchning er **tidligt indhold mere kritisk** — enhver ændring ugyldiggør alt efterfølgende indhold:

1. **Præfiksmatchning starter fra begyndelsen**: KV-Cache sammenligner den aktuelle anmodning med det cachede præfiks token for token fra starten. I det øjeblik en uoverensstemmelse opdages, ugyldiggøres alt efterfølgende indhold.

2. **Tools ændres = hele cache ugyldiggøres**: Da Tools kommer først, vil enhver ændring i værktøjsdefinitioner (selv tilføjelse eller fjernelse af et enkelt MCP-tool) **bryde præfikset helt fra starten** og ugyldiggøre al cachet System Prompt og Messages.

3. **System ændres = Messages-cache ugyldiggøres**: System Prompt befinder sig i midten, så dens ændringer ugyldiggør kun den efterfølgende Messages-del.

4. **Messages ændres = kun halen påvirkes**: Messages er i slutningen, så tilføjelse af nye beskeder ugyldiggør kun et lille afsluttende segment — Tools- og System-cache forbliver intakt.

## Praktisk betydning

| Ændringstype | Cache-påvirkning | Typisk scenarie |
|--------------|-----------------|-----------------|
| Tool tilføjet/fjernet | **Fuld ugyldiggørelse** | MCP server tilslut/frakobl, IDE-plugin til/fra |
| System Prompt ændring | Messages-cache tabt | CLAUDE.md redigering, system reminder-injektion |
| Ny besked tilføjet | Kun hale-tilvækst | Normal samtalegång (mest almindelig, billigst) |

Det er derfor `tools_change` i [CacheRebuild](CacheRebuild.md) typisk er den dyreste genopbygningsårsag — det bryder præfikskæden helt forrest.

## Hvorfor placeres værktøjsdefinitioner før "hjernen"?

Fra et caching-perspektiv er det en teknisk kendsgerning, at Tools kommer først. Men fra et kognitivt designperspektiv er denne rækkefølge lige så logisk — **Tools er hænder og fødder, System Prompt er hjernen**.

Før man handler, skal man opfatte, hvilke lemmer og værktøjer man har til rådighed. Et spædbarn forstår ikke først verdens regler (System) og lærer derefter at gribe — det opfatter først, at det har hænder og fødder, og forstår gradvist reglerne gennem interaktion med omgivelserne. På samme måde skal en LLM vide, hvilke værktøjer den kan kalde (læse filer, skrive kode, søge, udføre kommandoer) før den modtager opgaveinstruktioner (System Prompt), så den præcist kan vurdere "hvad kan jeg gøre" og "hvordan skal jeg gøre det" ved behandling af instruktionerne.

Hvis det var omvendt — først fortælle modellen "din opgave er at refaktorere dette modul", derefter "du har Read, Edit, Bash-værktøjer" — ville modellen mangle kritisk information om sine kapabilitetsgræenser ved forståelse af opgaven, hvilket potentielt kunne føre til urealistiske planer eller overseelse af tilgængelige tilgange.

**Kend dine kort før du beslutter, hvordan du spiller.** Dette er den kognitive logik bag at Tools placeres før System.

## Hvorfor er MCP-værktøjer også på denne position?

MCP-værktøjer (Model Context Protocol) placeres ligesom indbyggede værktøjer helt i starten af Tools-området. At forstå MCPs position i konteksten hjælper med at vurdere de reelle fordele og omkostninger.

### MCP-fordele

- **Kapabilitetsudvidelse**: MCP lader modeller tilgå eksterne tjenester (databaseforespørgsler, API-kald, IDE-operationer, browserstyring osv.), og overgår grænserne for indbyggede værktøjer
- **Åbent økosystem**: Enhver kan implementere en MCP-server; modellen opnår nye kapabiliteter uden gentræning
- **On-demand-indlæsning**: MCP-servere kan selektivt tilsluttes/frakobles efter opgavescenario, med fleksibel sammensætning af værktøjssæt

### MCP-omkostninger

- **Cache-dræber**: Hvert MCP-værktøjs JSON Schema-definition sammenkædes i starten af KV-Cache-præfikset. Tilføjelse eller fjernelse af ét MCP-værktøj = **hele cachen invalideret fra starten**. Hyppig tilslutning/frakobling af MCP-servere reducerer cache-hitraten drastisk
- **Præfiks-oppustning**: MCP-værktøjers Schemas er typisk større end indbyggede værktøjer (detaljerede parameterbeskrivelser, enum-værdier osv.). Mange MCP-værktøjer øger token-antallet i Tools-området markant og indskrænker kontekstrummet til Messages
- **Latens-overhead**: MCP-værktøjskald kræver inter-proces-kommunikation (JSON-RPC over stdio/SSE), en størrelsesorden langsommere end indbyggede funktionskald
- **Stabilitetsrisiko**: MCP-servere er eksterne processer, der kan crashe, timeout'e eller returnere uventede formater, og kræver ekstra fejlhåndtering

### Praktiske anbefalinger

| Scenarie | Anbefaling |
|----------|-----------|
| Lange samtaler, hyppig interaktion | Minimér antallet af MCP-værktøjer for at beskytte cache-præfiks-stabiliteten |
| Korte opgaver, engangsoperationer | Brug MCP-værktøjer frit; cache-påvirkningen er begrænset |
| Hyppig tilføjelse/fjernelse af MCP-servere | Hver ændring udløser fuld cache-genopbygning; overvej at fastlåse værktøjssættet |
| Overdimensionerede Tool Schemas | Beskær beskrivelser og enums for at reducere præfiks-tokenforbrug |

I cc-viewers Context-panel vises MCP-værktøjer sammen med indbyggede værktøjer i Tools-området, hvilket giver et klart overblik over hvert værktøjs Schema-størrelse og bidrag til cache-præfikset.
