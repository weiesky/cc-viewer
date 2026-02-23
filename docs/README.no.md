# CC-Viewer

Et overvåkingssystem for forespørsler i Claude Code som fanger opp og visualiserer alle API-forespørsler og -svar i sanntid. Hjelper utviklere med å overvåke Context for gjennomgang og feilsøking under Vibe Coding.

[简体中文](./README.zh.md) | [English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Bruk

```bash
npm install -g cc-viewer
```

Etter installasjon, kjør:

```bash
ccv
```

Denne kommandoen konfigurerer automatisk din lokalt installerte Claude Code for overvåking og legger til en automatisk reparasjonskrok i shell-konfigurasjonen din (`~/.zshrc` eller `~/.bashrc`). Bruk deretter Claude Code som vanlig og åpne `http://localhost:7008` i nettleseren for å se overvåkingsgrensesnittet.

Etter at Claude Code oppdateres, trengs ingen manuell handling — neste gang du kjører `claude`, vil den automatisk oppdage og rekonfigurere.

### Avinstallering

```bash
ccv --uninstall
```

## Funksjoner

### Forespørselsovervåking (Raw-modus)

- Sanntidsfangst av alle API-forespørsler fra Claude Code, inkludert strømmende svar
- Venstre panel viser forespørselsmetode, URL, varighet og statuskode
- Identifiserer og merker automatisk Main Agent- og Sub Agent-forespørsler (undertyper: Bash, Task, Plan, General)
- Høyre panel støtter veksling mellom Request / Response-faner
- Request Body utvider `messages`, `system`, `tools` ett nivå som standard
- Response Body er fullt utvidet som standard
- Veksle mellom JSON-visning og ren tekstvisning
- Kopier JSON-innhold med ett klikk
- MainAgent-forespørsler støtter Body Diff JSON, viser sammenfoldet forskjeller med forrige MainAgent-forespørsel (kun endrede/nye felter)
- Body Diff JSON-tooltip kan lukkes; når det er lukket, lagres preferansen på serveren og vises aldri igjen
- Sensitive headere (`x-api-key`, `authorization`) maskeres automatisk i JSONL-loggfiler for å forhindre lekkasje av legitimasjon
- Innebygd token-forbruksstatistikk per forespørsel (input/output-tokens, cache-opprettelse/-lesing, treffrate)

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
- Systemtekst automatisk filtrert, viser kun reell brukerinndata
- Flersesjonsegmentert visning (automatisk segmentert etter `/compact`, `/clear`, osv.)
- Hver melding viser et tidsstempel nøyaktig til sekundet, utledet fra API-forespørselstiming
- Innstillingspanel: veksle standard sammenfoldet tilstand for verktøyresultater og tenkningsblokker

### Oversettelse

- Thinking-blokker og Assistant-meldinger støtter ett-klikks oversettelse
- Basert på Claude Haiku API, støtter både API Key (`x-api-key`) og OAuth Bearer Token-autentisering
- Oversettelsesresultater caches automatisk; klikk igjen for å bytte tilbake til originalteksten
- Lastespinner-animasjon vises under oversettelse

### Token-statistikk

Svevepanel i topptekstområdet:

- Token-antall gruppert etter modell (input/output)
- Cache creation/read-antall og cache-treffrate
- Main Agent cache-utløpsnedtelling

### Loggadministrasjon

Via CC-Viewer-rullegardinmenyen øverst til venstre:

- Importer lokale logger: bla gjennom historiske loggfiler, gruppert etter prosjekt, åpnes i nytt vindu
- Last inn lokal JSONL-fil: velg og last inn en lokal `.jsonl`-fil direkte (opptil 200MB)
- Last ned gjeldende logg: last ned den gjeldende overvåkings-JSONL-loggfilen
- Eksporter brukerforespørsler: trekk ut og vis alle brukerinndata, med XML-tagger (system-reminder osv.) sammenleggbare; skråstrekkommandoer (`/model`, `/context` osv.) vist som selvstendige oppføringer; kommandorelaterte tagger automatisk skjult fra prompt-innhold
- Eksporter forespørsler til TXT: eksporter brukerforespørsler (kun tekst, uten system-tagger) til en lokal `.txt`-fil

### Flerspråklig støtte

CC-Viewer støtter 18 språk og bytter automatisk basert på systemets lokalinnstilling:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
