# CC-Viewer

Et overvågningssystem for forespørgsler til Claude Code, der opfanger og visualiserer alle API-forespørgsler og -svar i realtid. Hjælper udviklere med at overvåge deres Context til gennemgang og fejlfinding under Vibe Coding.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Brug

### Installation

```bash
npm install -g cc-viewer
```

### Kørsel og automatisk konfiguration

```bash
ccv
```

Denne kommando registrerer automatisk din lokale Claude Code-installationsmetode (NPM eller Native Install) og tilpasser sig derefter.

- **NPM Install**: Indsprøjter automatisk aflytningsscripts i Claude Codes `cli.js`.
- **Native Install**: Registrerer automatisk `claude`-binærfilen, konfigurerer en lokal gennemsigtig proxy og opsætter en Zsh Shell Hook til automatisk at videresende trafik.

### Konfigurationsoverstyring (Configuration Override)

Hvis du har brug for at bruge et brugerdefineret API-slutpunkt (f.eks. virksomhedsproxy), skal du blot konfigurere det i `~/.claude/settings.json` eller indstille miljøvariablen `ANTHROPIC_BASE_URL`. `ccv` vil automatisk genkende dette og videresende anmodninger korrekt.

### Stille tilstand (Silent Mode)

Som standard kører `ccv` i stille tilstand, når den wrapper `claude`, hvilket sikrer, at dit terminaloutput forbliver rent og identisk med den originale Claude Code-oplevelse. Alle logs opfanges i baggrunden og kan ses på `http://localhost:7008`.

Efter konfiguration skal du bruge kommandoen `claude` som normalt. Besøg `http://localhost:7008` for at se overvågningsgrænsefladen.

### Fejlfinding (Troubleshooting)

- **Blandet output (Mixed Output)**: Hvis du ser `[CC-Viewer]` debug-logs blandet med Claude-output, skal du opdatere til den nyeste version (`npm install -g cc-viewer`).
- **Forbindelse afvist (Connection Refused)**: Sørg for, at `ccv`-baggrundsprocessen kører. Kørsel af `ccv` eller `claude` (efter hook-installation) bør starte den automatisk.
- **Tom krop (Empty Body)**: Hvis du ser "No Body" i Viewer, kan det skyldes ikke-standard SSE-formater. Viewer understøtter nu rå indholdsfangst som fallback.

### Tjek version (Check Version)

```bash
ccv --version
```

### Afinstallation

```bash
ccv --uninstall
```

## Funktioner

### Overvågning af forespørgsler (Raw Mode)

- Realtidsopfangning af alle API-forespørgsler fra Claude Code, inklusive streaming-svar
- Venstre panel viser forespørgselsmetode, URL, varighed og statuskode
- Identificerer og mærker automatisk Main Agent- og Sub Agent-forespørgsler (undertyper: Bash, Task, Plan, General)
- Forespørgselslisten ruller automatisk til det valgte element (centreret ved modusskift, nærmeste ved manuelt klik)
- Højre panel understøtter Request / Response fane-skift
- Request Body udvider `messages`, `system`, `tools` ét niveau som standard
- Response Body fuldt udvidet som standard
- Skift mellem JSON-visning og ren tekstvisning
- Kopiér JSON-indhold med ét klik
- MainAgent-anmodninger understøtter Body Diff JSON, viser sammenfoldet forskelle med den forrige MainAgent-anmodning (kun ændrede/tilføjede felter)
- Diff-sektionen understøtter skift mellem JSON- og tekstvisning samt kopiering med ét klik
- Indstillingen "Expand Diff": når aktiveret, udvides diff-sektionen automatisk for MainAgent-anmodninger
- Body Diff JSON-tooltip kan lukkes; når det er lukket, gemmes præferencen på serveren og vises aldrig igen
- Følsomme headers (`x-api-key`, `authorization`) maskeres automatisk i JSONL-logfiler for at forhindre lækage af legitimationsoplysninger
- Inline token-forbrugsstatistik per anmodning (input/output tokens, cache-oprettelse/-læsning, hitrate)
- Kompatibel med Claude Code Router (CCR) og andre proxy-opsætninger — anmodninger matches via API-stimønster som fallback

### Chat Mode

Klik på "Chat mode"-knappen øverst til højre for at parse Main Agent's fulde samtalehistorik til en chatgrænseflade:

- Brugermeddelelser højrejusteret (blå bobler), Main Agent-svar venstrejusteret (mørke bobler) med Markdown-gengivelse
- `/compact`-meddelelser registreres automatisk og vises sammenklappet, klik for at udvide fuld opsummering
- Værktøjskaldsresultater vist inline i den tilhørende Assistant-meddelelse
- `thinking`-blokke skjult som standard, gengivet som Markdown, klik for at udvide; understøtter oversættelse med ét klik
- `tool_use` vist som kompakte værktøjskaldskort (Bash, Read, Edit, Write, Glob, Grep, Task har hver deres dedikerede visning)
- Task (SubAgent) værktøjsresultater gengivet som Markdown
- Brugervalgmeddelelser (AskUserQuestion) vist i spørgsmål-og-svar-format
- Systemtags (`<system-reminder>`, `<project-reminder>`, osv.) automatisk skjult
- Skill-indlæsningsmeddelelser registreres automatisk og foldes sammen med Skill-navn; klik for at udvide fuld dokumentation (Markdown-gengivelse)
- Skills reminder registreres automatisk og foldes sammen
- Systemtekst automatisk filtreret, viser kun reel brugerinput
- Visning opdelt i flere sessioner (automatisk opdelt efter `/compact`, `/clear`, osv.)
- Hver meddelelse viser et tidsstempel nøjagtigt til sekundet, afledt fra API-anmodningstiming
- Hver meddelelse har et "Vis forespørgsel"-link til at springe tilbage til raw-tilstand ved den tilsvarende API-anmodning
- Tovejs-modussynkronisering: skift til chat-tilstand ruller til samtalen der matcher den valgte forespørgsel; skift tilbage ruller til den valgte forespørgsel
- Indstillingspanel: skift standardsammenklappet tilstand for værktøjsresultater og tænkeblokke
- Globale indstillinger: slå filtrering af irrelevante forespørgsler til/fra (count_tokens, heartbeat)

### Oversættelse

- Thinking-blokke og Assistant-meddelelser understøtter oversættelse med ét klik
- Baseret på Claude Haiku API, understøtter både API Key (`x-api-key`) og OAuth Bearer Token godkendelse
- Oversættelsesresultater caches automatisk; klik igen for at skifte tilbage til originalteksten
- Indlæsnings-spinner-animation vises under oversættelse

### Token Stats

Svævepanel i headerområdet:

- Token-antal grupperet efter model (input/output)
- Cache-oprettelses-/læseantal og cache-hitrate
- Cache-genopbygningsstatistik grupperet efter årsag (TTL, system-/værktøjs-/modelændring, beskedafkortning/-ændring, nøgleændring) med antal og cache_creation tokens
- Værktøjsbrugsstatistik: antal kald pr. værktøj, sorteret efter hyppighed
- Skill-brugsstatistik: kaldsfrekvens pr. Skill, sorteret efter hyppighed
- Koncepthjælp (?)-ikoner: klik for at se indbygget dokumentation for MainAgent, CacheRebuild og hvert værktøj
- Main Agent cache-udløbsnedtælling

### Logstyring

Via CC-Viewer-rullemenuen øverst til venstre:

- Importér lokale logs: gennemse historiske logfiler, grupperet efter projekt, åbner i nyt vindue
- Indlæs lokal JSONL-fil: vælg og indlæs en lokal `.jsonl`-fil direkte (op til 500MB)
- Download nuværende log: download den aktuelle overvågnings-JSONL-logfil
- Flet logs: kombiner flere JSONL-logfiler til én session for samlet analyse
- Eksportér brugerprompter: se bruger-Prompts: udtræk og vis alle brugerinput med tre visningstilstande — Originaltilstand (rå indhold), Konteksttilstand (systemtags kan foldes), Teksttilstand (kun ren tekst); slash-kommandoer (`/model`, `/context` osv.) vises som selvstændige poster; kommandorelaterede tags skjules automatisk fra Prompt-indholdet
- Eksportér prompter til TXT: eksportér brugerprompter (kun tekst, uden system-tags) til en lokal `.txt`-fil

### Flersproget understøttelse

CC-Viewer understøtter 18 sprog og skifter automatisk baseret på systemets lokalitet:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
