# CC-Viewer

Et overvågningssystem for forespørgsler til Claude Code, der opfanger og visualiserer alle API-forespørgsler og -svar i realtid. Hjælper udviklere med at overvåge deres Context til gennemgang og fejlfinding under Vibe Coding.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Brug

```bash
npm install -g cc-viewer
```

Efter installation, kør:

```bash
ccv
```

Denne kommando konfigurerer automatisk din lokalt installerede Claude Code til overvågning og tilføjer en auto-reparations hook til din shell-konfiguration (`~/.zshrc` eller `~/.bashrc`). Brug derefter Claude Code som normalt og åbn `http://localhost:7008` i din browser for at se overvågningsgrænsefladen.

Efter Claude Code opdaterer, er der ingen manuel handling nødvendig — næste gang du kører `claude`, vil den automatisk registrere og genkonfigurere.

### Afinstallation

```bash
ccv --uninstall
```

## Funktioner

### Overvågning af forespørgsler (Raw Mode)

- Realtidsopfangning af alle API-forespørgsler fra Claude Code, inklusive streaming-svar
- Venstre panel viser forespørgselsmetode, URL, varighed og statuskode
- Identificerer og mærker automatisk Main Agent- og Sub Agent-forespørgsler (undertyper: Bash, Task, Plan, General)
- Højre panel understøtter Request / Response fane-skift
- Request Body udvider `messages`, `system`, `tools` ét niveau som standard
- Response Body fuldt udvidet som standard
- Skift mellem JSON-visning og ren tekstvisning
- Kopiér JSON-indhold med ét klik
- MainAgent-anmodninger understøtter Body Diff JSON, viser sammenfoldet forskelle med den forrige MainAgent-anmodning (kun ændrede/tilføjede felter)
- Body Diff JSON-tooltip kan lukkes; når det er lukket, gemmes præferencen på serveren og vises aldrig igen
- Inline token-forbrugsstatistik per anmodning (input/output tokens, cache-oprettelse/-læsning, hitrate)

### Chat Mode

Klik på "Chat mode"-knappen øverst til højre for at parse Main Agent's fulde samtalehistorik til en chatgrænseflade:

- Brugermeddelelser højrejusteret (blå bobler), Main Agent-svar venstrejusteret (mørke bobler) med Markdown-gengivelse
- `/compact`-meddelelser registreres automatisk og vises sammenklappet, klik for at udvide fuld opsummering
- Værktøjskaldsresultater vist inline i den tilhørende Assistant-meddelelse
- `thinking`-blokke skjult som standard, gengivet som Markdown, klik for at udvide
- `tool_use` vist som kompakte værktøjskaldskort (Bash, Read, Edit, Write, Glob, Grep, Task har hver deres dedikerede visning)
- Task (SubAgent) værktøjsresultater gengivet som Markdown
- Brugervalgmeddelelser (AskUserQuestion) vist i spørgsmål-og-svar-format
- Systemtags (`<system-reminder>`, `<project-reminder>`, osv.) automatisk skjult
- Skill-indlæsningsmeddelelser registreres automatisk og foldes sammen med Skill-navn; klik for at udvide fuld dokumentation (Markdown-gengivelse)
- Systemtekst automatisk filtreret, viser kun reel brugerinput
- Visning opdelt i flere sessioner (automatisk opdelt efter `/compact`, `/clear`, osv.)
- Hver meddelelse viser et tidsstempel nøjagtigt til sekundet, afledt fra API-anmodningstiming
- Indstillingspanel: skift standardsammenklappet tilstand for værktøjsresultater og tænkeblokke

### Token Stats

Svævepanel i headerområdet:

- Token-antal grupperet efter model (input/output)
- Cache-oprettelses-/læseantal og cache-hitrate
- Main Agent cache-udløbsnedtælling

### Logstyring

Via CC-Viewer-rullemenuen øverst til venstre:

- Importér lokale logs: gennemse historiske logfiler, grupperet efter projekt, åbner i nyt vindue
- Indlæs lokal JSONL-fil: vælg og indlæs en lokal `.jsonl`-fil direkte (op til 200 MB)
- Download nuværende log: download den aktuelle overvågnings-JSONL-logfil
- Eksportér brugerprompter: udtræk og vis alle brugerinput, med XML-tags (system-reminder osv.) sammenklappelige; slash-kommandoer (`/model`, `/context` osv.) vist som selvstændige poster; kommandorelaterede tags automatisk skjult fra prompt-indhold
- Eksportér prompter til TXT: eksportér brugerprompter (kun tekst, uden system-tags) til en lokal `.txt`-fil

### Flersproget understøttelse

CC-Viewer understøtter 18 sprog og skifter automatisk baseret på systemets lokalitet:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
