# KV-Cache hurtigbufferinnhold

## Hva er Prompt Caching?

Når du samtaler med Claude, sender hver API-forespørsel den komplette samtalekonteksten (system prompt + verktøydefinisjoner + meldingshistorikk). Anthropics prompt caching-mekanisme hurtigbufrer allerede beregnet prefiksinnhold på serversiden, og hvis prefikset er det samme ved påfølgende forespørsler, gjenbrukes hurtigbufferresultatet direkte, noe som hopper over gjentatte beregninger og reduserer forsinkelse og kostnader betydelig.

I cc-viewer kalles denne mekanismen "KV-Cache", som tilsvarer prompt caching på Anthropic API-nivå — ikke key-value cachen i transformerens oppmerksomhetslag internt i LLM-en.

## Hvordan hurtigbufferen fungerer

Anthropics prompt caching setter sammen hurtigbuffernøkler i en fast rekkefølge:

```
Tools → System Prompt → Messages (til cache breakpoint)
```

Så lenge dette prefikset er helt identisk med en hvilken som helst forespørsel innenfor TTL-vinduet, vil API-et treffe hurtigbufferen (returnerer `cache_read_input_tokens`) i stedet for å beregne på nytt (`cache_creation_input_tokens`).

> **Claude Code er ikke sterkt avhengig av `cache_control`-attributten — serveren fjerner noen av disse attributtene, men kan likevel opprette hurtigbuffer fint, så fraværet av `cache_control`-attributten betyr ikke at innholdet ikke er hurtigbufret**
>
> For spesialklienter som Claude Code er Anthropics server ikke fullstendig avhengig av `cache_control`-attributten i forespørselen for å bestemme hurtigbufferatferd. Serveren utfører automatisk hurtigbufferstrategier for spesifikke felt (som system prompt og verktøydefinisjoner), selv når forespørselen ikke eksplisitt inneholder `cache_control`-markører. Derfor trenger du ikke undre deg når du ikke ser denne attributten i forespørselens body — serveren har allerede utført hurtigbufferoperasjonen bak kulissene, den har bare ikke eksponert denne informasjonen for klienten. Dette er en stilltiende avtale mellom Claude Code og Anthropic API.

## Hva er "gjeldende KV-Cache hurtigbufferinnhold"?

"Gjeldende KV-Cache hurtigbufferinnhold" som vises i cc-viewer, er innhold hentet fra den siste MainAgent-forespørselen, som befinner seg før hurtigbuffergrensen (cache breakpoint). Det inkluderer spesifikt:

- **System Prompt**: Claude Codes systeminstruksjoner, inkludert kjerne-agentinstruksjoner, retningslinjer for verktøybruk, CLAUDE.md-prosjektinstruksjoner, miljøinformasjon osv.
- **Tools**: Listen over tilgjengelige verktøydefinisjoner (som Read, Write, Bash, Agent, MCP-verktøy osv.)
- **Messages**: Den hurtigbufrede delen av samtalehistorikken (vanligvis eldre meldinger, opp til siste `cache_control`-markering)

## Hvorfor se på hurtigbufferinnholdet?

1. **Forstå konteksten**: Vit hva Claude for øyeblikket "husker", og hjelp deg med å vurdere om atferden er som forventet
2. **Kostnadsoptimalisering**: Hurtigbuffertreff koster langt mindre enn omberegning. Å se hurtigbufferinnholdet hjelper deg med å forstå hvorfor visse forespørsler utløste hurtigbuffer-gjenoppbygging (cache rebuild)
3. **Feilsøking av samtale**: Når Claudes svar ikke samsvarer med forventningene, kan kontroll av hurtigbufferinnholdet bekrefte om system prompt og meldingshistorikk er korrekte
4. **Overvåking av kontekstkvalitet**: Under feilsøking, endring av konfigurasjon eller justering av prompts gir KV-Cache-Text et sentralisert perspektiv som hjelper deg med raskt å bekrefte om kjernekonteksten har forverret seg eller blitt forurenset av uventet innhold — uten å måtte gjennomgå originale meldinger én etter én

## Flerlags hurtigbufferstrategi

KV-Cachen tilhørende Claude Code er ikke bare én enkelt hurtigbuffer. Serveren genererer separate hurtigbuffere for Tools og System Prompt, uavhengig av Messages-hurtigbufferen. Fordelen med dette designet er: når meldingsstabelen blir forstyrret (f.eks. kontekstavkorting, meldingsendringer) og krever gjenoppbygging, invaliderer det ikke samtidig Tools- og System Prompt-hurtigbuffrene, noe som unngår fullstendig omberegning.

Dette er en optimaliseringsstrategi på serversiden — fordi Tools-definisjoner og System Prompt er relativt stabile under normal bruk og sjelden endres, maksimerer separat hurtigbufring av dem reduksjonen av unødvendig gjenoppbyggingskostnad. Så når du observerer hurtigbufferen, vil du legge merke til at bortsett fra Tools-gjenoppbygging, som krever fullstendig oppdatering av alle hurtigbuffere, kan ødeleggelse av System Prompt og Messages fortsatt arve tilgjengelige hurtigbuffere.

## Hurtigbufferlivssyklus

- **Opprettelse**: Ved første forespørsel eller etter at hurtigbufferen er utløpt, oppretter API-et en ny hurtigbuffer (`cache_creation_input_tokens`)
- **Treff**: Påfølgende forespørsler med identisk prefiks gjenbruker hurtigbufferen (`cache_read_input_tokens`)
- **Utløp**: Hurtigbufferen har en TTL (levetid) på 5 minutter og utløper automatisk deretter
- **Gjenoppbygging**: Når system prompt, verktøyliste, modell eller meldingsinnhold endres, samsvarer ikke hurtigbuffernøkkelen, noe som utløser gjenoppbygging av det tilsvarende nivået
