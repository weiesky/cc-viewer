# KV-Cache cacheindhold

## Hvad er Prompt Caching?

Når du samtaler med Claude, sender hver API-anmodning den komplette samtalekontekst (system prompt + værktøjsdefinitioner + beskedhistorik). Anthropics prompt caching-mekanisme cacher allerede beregnet præfiksindhold på serversiden, og hvis præfikset er det samme ved efterfølgende anmodninger, genbruges cacheresultatet direkte, hvilket springer gentagne beregninger over og reducerer latens og omkostninger betydeligt.

I cc-viewer omtales denne mekanisme som "KV-Cache", der svarer til prompt caching på Anthropic API-niveau — ikke key-value cachen i transformerens opmærksomhedslag internt i LLM'en.

## Hvordan caching fungerer

Anthropics prompt caching sammenkæder cachenøgler i en fast rækkefølge:

```
Tools → System Prompt → Messages (til cache breakpoint)
```

Så længe dette præfiks er helt identisk med en hvilken som helst anmodning inden for TTL-vinduet, rammer API'en cachen (returnerer `cache_read_input_tokens`) i stedet for at genberegne (`cache_creation_input_tokens`).

> **Claude Code er ikke stærkt afhængig af `cache_control`-attributten — serveren fjerner nogle af disse attributter, men kan stadig oprette cache fint, så fraværet af `cache_control`-attributten betyder ikke, at indholdet ikke er cachet**
>
> For specialklienter som Claude Code er Anthropics server ikke fuldstændig afhængig af `cache_control`-attributten i anmodningen til at bestemme cache-adfærd. Serveren udfører automatisk cache-strategier for specifikke felter (som system prompt og værktøjsdefinitioner), selv når anmodningen ikke eksplicit indeholder `cache_control`-markører. Derfor behøver du ikke undre dig, når du ikke ser denne attribut i anmodningens body — serveren har allerede udført cache-operationen bag kulisserne, den har bare ikke eksponeret denne information for klienten. Dette er en stiltiende aftale mellem Claude Code og Anthropic API.

## Hvad er "aktuelt KV-Cache cacheindhold"?

Det "aktuelle KV-Cache cacheindhold" vist i cc-viewer er indhold udtrukket fra den seneste MainAgent-anmodning, som befinder sig før cachegrænsen (cache breakpoint). Det omfatter specifikt:

- **System Prompt**: Claude Codes systeminstruktioner, herunder kerne-agent-instruktioner, retningslinjer for værktøjsbrug, CLAUDE.md-projektinstruktioner, miljøinformation osv.
- **Tools**: Listen over aktuelt tilgængelige værktøjsdefinitioner (såsom Read, Write, Bash, Agent, MCP-værktøjer osv.)
- **Messages**: Den del af samtalehistorikken, der er cachet (normalt ældre beskeder, op til det sidste `cache_control`-mærke)

## Hvorfor se cacheindholdet?

1. **Forstå konteksten**: Vid hvad Claude i øjeblikket "husker", og hjælp dig med at vurdere, om dens adfærd matcher forventningerne
2. **Omkostningsoptimering**: Cache-hit koster langt mindre end genberegning. At se cacheindholdet hjælper dig med at forstå, hvorfor visse anmodninger udløste cache-genopbygning (cache rebuild)
3. **Fejlfinding af samtale**: Når Claudes svar ikke matcher forventningerne, kan kontrol af cacheindholdet bekræfte, om system prompt og beskedhistorik er korrekte
4. **Overvågning af kontekstkvalitet**: Under fejlfinding, ændring af konfiguration eller justering af prompts giver KV-Cache-Text et centraliseret overblik, der hjælper dig med hurtigt at bekræfte, om kernekonteksten er forringet eller forurenet med uventet indhold — uden at skulle gennemgå rå beskeder én efter én

## Flerlags cachestrategi

KV-Cachen tilhørende Claude Code er ikke blot én enkelt cache. Serveren genererer separate cacher for Tools og System Prompt, uafhængigt af Messages-cacheen. Fordelen ved dette design er: når beskedstakken bliver forstyrret (f.eks. kontekstafkortning, beskedændringer) og kræver genopbygning, invaliderer det ikke samtidig Tools- og System Prompt-cacherne, hvilket undgår fuldstændig genberegning.

Dette er en optimeringstrategi på serversiden — fordi Tools-definitioner og System Prompt er relativt stabile under normal brug og sjældent ændres, maksimerer separat caching af dem reduktionen af unødvendig genopbygningsomkostning. Så når du observerer cachen, vil du bemærke, at bortset fra Tools-genopbygning, som kræver fuldstændig genopfriskning af alle cacher, kan ødelæggelse af System Prompt og Messages stadig arve tilgængelige cacher.

## Cache-livscyklus

- **Oprettelse**: Ved første anmodning eller efter cache-udløb opretter API'en en ny cache (`cache_creation_input_tokens`)
- **Hit**: Efterfølgende anmodninger med identisk præfiks genbruger cachen (`cache_read_input_tokens`)
- **Udløb**: Cachen har en TTL (time-to-live) på 5 minutter og udløber automatisk derefter
- **Genopbygning**: Når system prompt, værktøjsliste, model eller beskedindhold ændres, matcher cachenøglen ikke, hvilket udløser genopbygning af det tilsvarende niveau
