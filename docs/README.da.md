# CC-Viewer

Claude Code forespørgselsovervågningssystem, der fanger og visuelt viser alle API-forespørgsler og -svar fra Claude Code i realtid (rå tekst, uden beskæring). Praktisk for udviklere til at overvåge deres Context og gennemgå samt fejlfinde problemer under Vibe Coding.

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | Dansk | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Brug

### Installation

```bash
npm install -g cc-viewer
```

### Kørsel og automatisk konfiguration

```bash
ccv
```

Denne kommando registrerer automatisk den lokale Claude Code-installationsmetode (NPM eller Native Install) og tilpasser sig derefter.

- **NPM-installation**: Indsprøjter automatisk aflytningsscripts i Claude Codes `cli.js`.
- **Native Install**: Registrerer automatisk `claude`-binærfilen, konfigurerer en lokal gennemsigtig proxy og opsætter en Zsh Shell Hook til automatisk at videresende trafik.

### Konfigurationsoverstyring (Configuration Override)

Hvis du har brug for at bruge et brugerdefineret API-slutpunkt (f.eks. virksomhedsproxy), skal du blot konfigurere det i `~/.claude/settings.json` eller indstille miljøvariablen `ANTHROPIC_BASE_URL`. `ccv` vil automatisk genkende dette og videresende anmodninger korrekt.

### Stille tilstand (Silent Mode)

Som standard kører `ccv` i stille tilstand, når den wrapper `claude`, hvilket sikrer, at dit terminaloutput forbliver rent og identisk med den originale oplevelse. Alle logs opfanges i baggrunden og kan ses på `http://localhost:7008`.

Efter konfiguration skal du bruge kommandoen `claude` som normalt. Besøg `http://localhost:7008` for at se overvågningsgrænsefladen.

### Fejlfinding (Troubleshooting)

- **Blandet output (Mixed Output)**: Hvis du ser `[CC-Viewer]` debug-logs blandet med Claude-output, skal du opdatere til den nyeste version (`npm install -g cc-viewer`).
- **Forbindelse afvist (Connection Refused)**: Sørg for, at `ccv`-baggrundsprocessen kører. Kørsel af `ccv` eller `claude` (efter hook-installation) bør starte den automatisk.
- **Tom krop (Empty Body)**: Hvis du ser "No Body" i Viewer, kan det skyldes ikke-standard SSE-formater. Viewer understøtter nu rå indholdsfangst som fallback.

### Afinstallation

```bash
ccv --uninstall
```

### Tjek version

```bash
ccv --version
```

## Funktioner

### Forespørgselsovervågning (Originalteksttilstand)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Realtidsopfangning af alle API-forespørgsler fra Claude Code, sikrer at det er originalteksten og ikke beskårne logs (dette er vigtigt!!!)
- Identificerer og mærker automatisk Main Agent- og Sub Agent-forespørgsler (undertyper: Bash, Task, Plan, General)
- MainAgent-anmodninger understøtter Body Diff JSON, viser sammenfoldet forskelle med den forrige MainAgent-anmodning (kun ændrede/tilføjede felter)
- Inline token-forbrugsstatistik per anmodning (input/output tokens, cache-oprettelse/-læsning, hitrate)
- Kompatibel med Claude Code Router (CCR) og andre proxy-scenarier — anmodninger matches via API-stimønster som fallback

### Samtaletilstand

Klik på knappen "Samtaletilstand" øverst til højre for at parse Main Agents fulde samtalehistorik til en chatgrænseflade:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Understøtter endnu ikke visning af Agent Team
- Brugermeddelelser er højrejusterede (blå bobler), Main Agent-svar er venstrejusterede (mørke bobler)
- `thinking`-blokke er foldet som standard, renderet i Markdown, klik for at udvide og se tankeprocessen; understøtter oversættelse med ét klik (funktionen er stadig ustabil)
- Brugervalgmeddelelser (AskUserQuestion) vises i spørgsmål-svar-format
- Tovejs-tilstandssynkronisering: skift til samtaletilstand placerer automatisk ved den valgte anmodnings tilsvarende samtale; skift tilbage til originalteksttilstand placerer automatisk ved den valgte anmodning
- Indstillingspanel: skift standardfoldestatus for værktøjsresultater og tænkeblokke


### Statistikværktøjer

Svævepanel "Datastatistik" i header-området:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Viser antal cache creation/read og cache-hitrate
- Cache-genopbygningsstatistik: grupperet efter årsag (TTL, system/tools/model-ændringer, beskedafkortning/-ændring, nøgleændring) med antal og cache_creation tokens
- Værktøjsbrugsstatistik: viser kaldefrekvens for hvert værktøj sorteret efter antal kald
- Skill-brugsstatistik: viser kaldefrekvens for hver Skill sorteret efter antal kald
- Koncepthjælp (?)-ikon: klik for at se indbygget dokumentation for MainAgent, CacheRebuild og diverse værktøjer

### Logstyring

Via CC-Viewer-rullemenuen øverst til venstre:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importér lokale logs: gennemse historiske logfiler, grupperet efter projekt, åbner i nyt vindue
- Indlæs lokal JSONL-fil: vælg og indlæs en lokal `.jsonl`-fil direkte (understøtter op til 500MB)
- Gem nuværende log som: download den aktuelle overvågnings-JSONL-logfil
- Flet logs: kombiner flere JSONL-logfiler til én session for samlet analyse
- Se bruger-Prompts: udtræk og vis alle brugerinput med tre visningstilstande — Originaltilstand (rå indhold), Konteksttilstand (systemtags kan foldes), Teksttilstand (kun ren tekst); slash-kommandoer (`/model`, `/context` osv.) vises som selvstændige poster; kommandorelaterede tags skjules automatisk fra Prompt-indholdet
- Eksportér Prompt til TXT: eksportér brugerprompter (kun tekst, uden system-tags) til en lokal `.txt`-fil

### Flersproget understøttelse

CC-Viewer understøtter 18 sprog og skifter automatisk baseret på systemets lokalitet:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
