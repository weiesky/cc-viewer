# CC-Viewer

🌐 **Nettsted og funksjonsomvisning: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — tilgjengelig på 18 språk.


Et Vibe Coding-verktøysett destillert fra egen utviklingserfaring og bygget på Claude Code:

1. Hev evnetaket: Kjør /ultraPlan og /ultraReview lokalt, slik at prosjektkoden din aldri er fullt eksponert for Claudes sky;
2. Flerplattform-støtte: Muliggjør mobil programmering (i det lokale nettverket); webversjonen tilpasser seg ulike scenarier, kan enkelt bygges inn i nettleserutvidelser og operativsystemets delte skjerm, og leveres med en native installasjonspakke;
3. Fullstendig logging: Tilbyr omfattende opphenting og analyse av Claude Code-payloads — ideelt for logging, feilsøking, læring, inspirasjon og reverse-engineering;
4. Læring og erfaringsdeling: En rekke studiemateriell og utviklingserfaringer er samlet (se „?"-symbolene rundt om i systemet);
5. Native opplevelse bevart: Utvider kun Claude Codes evner uten vesentlige endringer i kjernen — den native opplevelsen er bevart;
6. Tredjepartsmodeller støttet: Kompatibel med deepseek-v4-\*, GLM 5.1, Kimi K2.6, med innebygd cc-switch-evne for hot-switching mellom tredjepartsverktøy når som helst; hot-switch-dialogen støtter også kilder per rolle — Main Agent, Sub-Agents og Teammates kan hver bruke en egen proxy-profil (standard: følg Main Agent); når Main Agent bruker den innebygde Default med det offisielle endepunktet, forblir rolletildeling skjult og inaktiv.

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | Norsk | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Bruk

### Forutsetninger

* Sørg for at Node.js 20.0.0+ er installert; [Last ned og installer](https://nodejs.org)
* Sørg for at Claude Code er installert; [Installasjonsveiledning](https://github.com/anthropics/claude-code)

### Installer ccv

#### Installasjon via npm

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### Installasjon via Homebrew (anbefalt for macOS / Linux)

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # bruk denne for oppgradering — bruk IKKE npm install -g for ccv installert via brew
```

#### Installasjon via pnpm (global)

```bash
pnpm add -g cc-viewer
pnpm add -g cc-viewer@latest   # bruk denne for oppgradering — bruk IKKE npm install -g for ccv installert via pnpm
```

### Slik starter du

ccv er en direkte erstatning for claude — alle argumenter sendes videre til claude, samtidig som Web Viewer startes.

```bash
ccv                    # == claude (interaktiv modus)
```

Kommandoen forfatteren bruker mest er:

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv sender videre alle Claude Codes oppstartsparametere — du kan kombinere dem som du vil
```

Etter at programmeringsmodusen er startet, åpnes en nettside automatisk.

cc-viewer kommer også som native desktop-app: [Nedlastingsside](https://github.com/weiesky/cc-viewer/releases)

### Oppgradering til 1.7.0 (loggformat v2)

Fra 1.7.0 lagres logger i et format med én mappe per økt (wire-format v2) i stedet for enkeltstående `.jsonl`-filer — omtrent 90 % mindre diskplass. Eksisterende v1-`.jsonl`-filer blir aldri endret eller slettet; loggdialogen viser v2-økter som standard, og en liten oppføring “Vis eldre (v1) logger” (vises så lenge det finnes gamle filer) åpner en v1-visning der de kan vises, migreres eller slettes. Ved oppstart tilbyr cc-viewer migrering med ett klikk når eldre logger blir funnet (sterkt anbefalt når du fortsetter en gammel samtale med `claude -c`, der første halvdel ligger i de gamle filene). Du kan også migrere fra terminalen:

```bash
ccv convert <project>   # migrer ett prosjekt
ccv convert --all       # migrer alle prosjekter
ccv verify <v1-file>    # sjekk en v1-fil mot dens konverterte økter
```

Hvis en økt ikke består golden-verifiseringen, holdes den tilbake i `sessions-quarantine/` for inspeksjon i stedet for at hele migreringen mislykkes – de øvrige øktene migreres fortsatt.

### Logger-modus

Hvis du fortsatt foretrekker det native claude-verktøyet eller VS Code-utvidelsen, bruker du denne modusen.

I denne modusen starter `claude`

automatisk en loggprosess som registrerer forespørselslogger til mapper per økt under \~/.claude/cc-viewer/*yourproject*/sessions/ (wire-format v2)

Start logger-modus:

```bash
ccv -logger
```

Når konsollet ikke kan skrive ut den spesifikke porten, er den første standardporten 127.0.0.1:7008. Ved flere samtidige instanser brukes fortløpende porter som 7009, 7010.

Avinstaller logger-modus:

```bash
ccv --uninstall
```

### Feilsøking (Troubleshooting)

Hvis du støter på oppstartsproblemer, er her den ultimate feilsøkingstilnærmingen:
Trinn 1: Åpne Claude Code i en hvilken som helst mappe;
Trinn 2: Gi Claude Code følgende instruks:

```
Jeg har installert npm-pakken cc-viewer, men etter å ha kjørt ccv fungerer det fortsatt ikke som det skal. Sjekk cli.js og findcc.js i cc-viewer og tilpass dem til den lokale Claude Code-utrullingen basert på det spesifikke miljøet. Hold endringene så begrenset som mulig til findcc.js.
```

Å la Claude Code diagnostisere problemet selv er mer effektivt enn å spørre noen eller lese dokumentasjon!

Når instruksjonen ovenfor er fullført, oppdateres findcc.js. Hvis prosjektet ditt ofte krever lokal utrulling eller forket kode ofte må løse installasjonsproblemer, bare behold denne filen. Neste gang kan du bare kopiere den. I dag er det mange prosjekter og selskaper som bruker Claude Code som ikke ruller ut på Mac, men i serverhostede miljøer, så forfatteren har separert findcc.js for å gjøre det lettere å spore cc-viewers kildekodeoppdateringer fremover.

Merk: Denne applikasjonen er i konflikt med claude-code-switch og claude-code-router, da det er et proxy-konkurranseproblem, så sørg for å deaktivere claude-code-switch og claude-code-router når du bruker cc-viewer — inne i cc-viewer leveres en proxy-hot-update-funksjon som tilsvarende erstatning.

### Andre hjelpekommandoer

Se:

```bash
ccv -h
```

### Silent-modus (Silent Mode)

Som standard kjører `ccv` i silent-modus når den pakker inn `claude`, og holder terminalutgangen din ren og i samsvar med den native opplevelsen. Alle logger fanges opp i bakgrunnen og kan ses på `http://localhost:7008`.

Etter konfigurasjon bruker du `claude`-kommandoen som normalt. Besøk `http://localhost:7008` for å få tilgang til overvåkingsgrensesnittet.

## Funksjoner

### Programmeringsmodus

Etter oppstart med ccv kan du se:

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

Du kan se code diffs direkte etter redigering:

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Selv om du manuelt kan åpne filer og kode, anbefales ikke manuell programmering — det er gammeldags koding!

### Mobil programmering

Du kan til og med skanne en QR-kode for å programmere fra mobilenheten din:

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

Oppfyll din forestilling om mobil programmering. Det finnes også en plugin-mekanisme — hvis du trenger tilpasninger til programmeringsvanene dine, kan du holde deg oppdatert om kommende plugin-hook-oppdateringer.

### Modellspesifikke systemprompter

Modalen **Rediger systemprompt** (hamburgermeny → Rediger systemprompt) er delt inn i faner:

* Fanen **Standard** beholder den klassiske oppførselen: den skriver `CC_SYSTEM.md` (overskriv) eller `CC_APPEND_SYSTEM.md` (legg til) i det gjeldende arbeidsområdet, injisert som `--system-prompt-file` / `--append-system-prompt-file` ved neste ccv-oppstart.
* **Modellfaner**: klikk på **+ Legg til modell**, skriv inn et navn som `opus` eller `Gemini3`, og velg et omfang — **Global** (`~/.claude/cc-viewer/system_prompt/`, gjelder for alle arbeidsområder) eller **Arbeidsområde** (`<project>/system_prompt/`). Navnefeltet gir forslag mens du skriver, fra dine lokalt konfigurerte modeller (hurtiginnlastede proxy-profiler og `settings.json`); navn som allerede er lagt til i det valgte omfanget skjules, og vilkårlige frie navn er fortsatt tillatt. Hver fane har sin egen Legg til/Overskriv-bryter og Markdown-forhåndsvisning.
* Oppføringene lagres som filer med store bokstaver: `OPUS_SYSTEM.md` (overskriv) eller `OPUS_APPEND_SYSTEM.md` (legg til). Matchingen er fuzzy — en delstreng, uten skille mellom store og små bokstaver, av modell-ID-en som utledes fra den AKTIVE konfigurasjonen (modelltilordningen til den aktive tredjeparts proxy-profilen > miljøvariablene `ANTHROPIC_MODEL`/`CLAUDE_MODEL` ved oppstart > `model` i `settings.json`; uten konfigurasjonssignal injiseres ingen oppføring), så `opus` matcher `claude-opus-4-8[1m]` uavhengig av versjon. Et treff i arbeidsområdet slår et globalt; innenfor et omfang vinner det lengste navnet; en matchet oppføring erstatter Standard-filene fullstendig for den oppstarten. Kjente begrensninger: bytte av proxy-profil midt i en økt matches først på nytt etter omstart av claude-økten; et `--model`-flagg sendt via ekstra argumenter tas ikke i betraktning.
* Lagres en fane tom, slettes oppføringen. Modellbytter gjort midt i en økt trer i kraft ved neste omstart. Sett `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` for å deaktivere all automatisk injeksjon. Du kan committe `<project>/system_prompt/` for å dele prompter med teamet ditt, eller legge den til i `.gitignore` for å holde dem private.

### Logger-modus (Se komplette Claude Code-økter)

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* Fanger alle API-forespørsler fra Claude Code i sanntid og sikrer råtekst — ikke redigerte logger (dette er viktig!!!)
* Identifiserer og merker automatisk Main Agent- og Sub Agent-forespørsler (undertyper: Plan, Search, Bash)
* MainAgent-forespørsler støtter Body Diff JSON og viser sammenklappede forskjeller fra forrige MainAgent-forespørsel (kun endrede/nye felter)
* Hver forespørsel viser inline Token-bruksstatistikk (input/output-Tokens, cache-opprettelse/-lesing, treffrate)
* Kompatibel med Claude Code Router (CCR) og andre proxy-scenarier — faller tilbake til mønstermatching av API-stier

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>

## Lisens

MIT
