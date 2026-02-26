# CC-Viewer
[![npm version](https://img.shields.io/npm/v/cc-viewer)](https://www.npmjs.com/package/cc-viewer)

Et overvåkingssystem for forespørsler i Claude Code som fanger opp og visualiserer alle API-forespørsler og -svar i sanntid. Hjelper utviklere med å overvåke Context for gjennomgang og feilsøking under Vibe Coding.

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Bruk

### Installasjon

```bash
npm install -g cc-viewer
```

### Kjøring og automatisk konfigurasjon

```bash
ccv
```

Denne kommandoen oppdager automatisk din lokale Claude Code-installasjonsmetode (NPM eller Native Install) og tilpasser seg deretter.

- **NPM Install**: Injiserer automatisk avskjæringsskript i Claude Codes `cli.js`.
- **Native Install**: Oppdager automatisk `claude`-binærfilen, konfigurerer en lokal gjennomsiktig proxy og setter opp en Zsh Shell Hook for å videresende trafikk automatisk.

### Konfigurasjonsoverstyring (Configuration Override)

Hvis du trenger å bruke et tilpasset API-endepunkt (f.eks. bedriftsproxy), konfigurer det enkelt i `~/.claude/settings.json` eller sett miljøvariabelen `ANTHROPIC_BASE_URL`. `ccv` vil automatisk gjenkjenne dette og videresende forespørsler korrekt.

### Stille modus (Silent Mode)

Som standard kjører `ccv` i stille modus når den wrapper `claude`, noe som sikrer at terminalutdataene dine forblir rene og identiske med den originale Claude Code-opplevelsen. Alle logger fanges opp i bakgrunnen og kan sees på `http://localhost:7008`.

Etter konfigurasjon, bruk `claude`-kommandoen som normalt. Besøk `http://localhost:7008` for å se overvåkingsgrensesnittet.

### Feilsøking (Troubleshooting)

- **Blandet utdata (Mixed Output)**: Hvis du ser `[CC-Viewer]` debug-logger blandet med Claude-utdata, vennligst oppdater til nyeste versjon (`npm install -g cc-viewer`).
- **Tilkobling avvist (Connection Refused)**: Sørg for at `ccv`-bakgrunnsprosessen kjører. Kjøring av `ccv` eller `claude` (etter hook-installasjon) skal starte den automatisk.
- **Tom kropp (Empty Body)**: Hvis du ser "No Body" i Viewer, kan det skyldes ikke-standard SSE-formater. Viewer støtter nå rå innholdsfangst som fallback.

### Sjekk versjon (Check Version)

```bash
ccv --version
```

### Avinstallering

```bash
ccv --uninstall
```

## Funksjoner

### Forespørselsovervåking (Raw-modus)

- Sanntidsfangst av alle API-forespørsler fra Claude Code, inkludert strømmende svar
- Venstre panel viser forespørselsmetode, URL, varighet og statuskode
- Identifiserer og merker automatisk Main Agent- og Sub Agent-forespørsler (undertyper: Bash, Task, Plan, General)
- Forespørselslisten ruller automatisk til det valgte elementet (sentrert ved modusbytte, nærmeste ved manuelt klikk)
- Høyre panel støtter veksling mellom Request / Response-faner
- Request Body utvider `messages`, `system`, `tools` ett nivå som standard
- Response Body er fullt utvidet som standard
- Veksle mellom JSON-visning og ren tekstvisning
- Kopier JSON-innhold med ett klikk
- MainAgent-forespørsler støtter Body Diff JSON, viser sammenfoldet forskjeller med forrige MainAgent-forespørsel (kun endrede/nye felter)
- Diff-seksjonen støtter veksling mellom JSON/Tekst-visning og ett-klikks kopiering
- «Utvid Diff»-innstilling: når aktivert, utvides diff-seksjonen automatisk for MainAgent-forespørsler
- Body Diff JSON-tooltip kan lukkes; når det er lukket, lagres preferansen på serveren og vises aldri igjen
- Sensitive headere (`x-api-key`, `authorization`) maskeres automatisk i JSONL-loggfiler for å forhindre lekkasje av legitimasjon
- Innebygd token-forbruksstatistikk per forespørsel (input/output-tokens, cache-opprettelse/-lesing, treffrate)
- Kompatibel med Claude Code Router (CCR) og andre proxy-oppsett — forespørsler matches via API-stimønster som fallback

### Chat-modus

Klikk på "Chat-modus"-knappen øverst til høyre for å analysere Main Agent sin fullstendige samtalehistorikk til et chat-grensesnitt:

- Brukermeldinger høyrejustert (blå bobler), Main Agent-svar venstrejustert (mørke bobler) med Markdown-gjengivelse
- `/compact`-meldinger oppdages automatisk og vises sammenfoldet, klikk for å utvide fullstendig sammendrag
- Verktøykallresultater vises innebygd i den tilhørende Assistant-meldingen
- `thinking`-blokker er skjult som standard, gjengitt som Markdown, klikk for å utvide; støtter ett-klikks oversettelse
- `tool_use` vises som kompakte verktøykallkort (Bash, Read, Edit, Write, Glob, Grep, Task har hver sin dedikerte visning)
- Task (SubAgent) verktøyresultater gjengitt som Markdown
- Brukervalg-meldinger (AskUserQuestion) vises i spørsmål-og-svar-format
- Systemtagger (`<system-reminder>`, `<project-reminder>`, osv.) automatisk skjult
- Skill-lastemeldinger oppdages automatisk og foldes sammen med Skill-navn; klikk for å utvide full dokumentasjon (Markdown-gjengivelse)
- Skills reminder oppdages automatisk og foldes sammen
- Systemtekst automatisk filtrert, viser kun reell brukerinndata
- Flersesjonsegmentert visning (automatisk segmentert etter `/compact`, `/clear`, osv.)
- Hver melding viser et tidsstempel nøyaktig til sekundet, utledet fra API-forespørselstiming
- Hver melding har en «Vis forespørsel»-lenke for å hoppe tilbake til raw-modus ved den tilsvarende API-forespørselen
- Toveis modussynkronisering: bytte til chat-modus ruller til samtalen som matcher den valgte forespørselen; bytte tilbake ruller til den valgte forespørselen
- Innstillingspanel: veksle standard sammenfoldet tilstand for verktøyresultater og tenkningsblokker
- Globale innstillinger: slå filtrering av irrelevante forespørsler av/på (count_tokens, heartbeat)

### Oversettelse

- Thinking-blokker og Assistant-meldinger støtter oversettelse med ett klikk
- Basert på Claude Haiku API, bruker kun `x-api-key`-autentisering (OAuth-sesjonstokens ekskluderes for å forhindre kontekstforurensning)
- Fanger automatisk haiku-modellnavnet fra mainAgent-forespørsler; standard er `claude-haiku-4-5-20251001`
- Oversettelsesresultater bufres automatisk; klikk igjen for å bytte tilbake til originalteksten
- Lasteanimasjon under oversettelse
- (?)-ikonet ved siden av `authorization`-headeren i forespørselsdetaljer lenker til konseptdokumentet om kontekstforurensning

### Token-statistikk

Svevepanel i topptekstområdet:

- Token-antall gruppert etter modell (input/output)
- Cache creation/read-antall og cache-treffrate
- Cache-gjenoppbyggingsstatistikk gruppert etter årsak (TTL, system/verktøy/modellendring, meldingstrunkering/-endring, nøkkelendring) med antall og cache_creation-tokens
- Verktøybruksstatistikk: antall kall per verktøy, sortert etter hyppighet
- Skill-bruksstatistikk: anropsfrekvens per Skill, sortert etter hyppighet
- Konsepthjelp (?)-ikoner: klikk for å se innebygd dokumentasjon for MainAgent, CacheRebuild og hvert verktøy
- Main Agent cache-utløpsnedtelling

### Loggadministrasjon

Via CC-Viewer-rullegardinmenyen øverst til venstre:

- Importer lokale logger: bla gjennom historiske loggfiler, gruppert etter prosjekt, åpnes i nytt vindu
- Last inn lokal JSONL-fil: velg og last inn en lokal `.jsonl`-fil direkte (opptil 500MB)
- Last ned gjeldende logg: last ned den gjeldende overvåkings-JSONL-loggfilen
- Slå sammen logger: kombiner flere JSONL-loggfiler til én økt for samlet analyse
- Se bruker-Prompts: trekk ut og vis alle brukerinndata med tre visningsmodi — Originalmodus (rå innhold), Kontekstmodus (systemtagger kan foldes), Tekstmodus (kun ren tekst); slash-kommandoer (`/model`, `/context` osv.) vises som selvstendige oppføringer; kommandorelaterte tagger skjules automatisk fra Prompt-innholdet
- Eksporter forespørsler til TXT: eksporter brukerforespørsler (kun tekst, uten system-tagger) til en lokal `.txt`-fil

### Flerspråklig støtte

CC-Viewer støtter 18 språk og bytter automatisk basert på systemets lokalinnstilling:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
