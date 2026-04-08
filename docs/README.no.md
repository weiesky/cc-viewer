# CC-Viewer

Overvakingssystem for Claude Code-foresporsler som fanger opp og visualiserer alle API-foresporsler og -svar i sanntid (originaltekst, uten sensurering). Gjor det enkelt for utviklere a overvake sin egen Context, slik at det er lettere a ga tilbake og feilsoke problemer under Vibe Coding.
Den nyeste versjonen av CC-Viewer tilbyr ogsa losninger for serverbasert webprogrammering, samt verktoy for mobilprogrammering. Alle er velkomne til a bruke dette i sine egne prosjekter. Flere plugin-funksjoner og skydistribusjon vil komme i fremtiden.

Forst det interessante — dette kan du se pa mobilenheten:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | Norsk | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Bruk

### Installasjon

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Programmeringsmodus

ccv er en direkte erstatning for claude. Alle parametere sendes videre til claude, samtidig som Web Viewer starter.

```bash
ccv                    # == claude (interaktiv modus)
ccv -c                 # == claude --continue (fortsett forrige samtale)
ccv -r                 # == claude --resume (gjenoppta samtale)
ccv -p "hello"         # == claude --print "hello" (utskriftsmodus)
ccv --d                # == claude --dangerously-skip-permissions (snarvei)
ccv --model opus       # == claude --model opus
```

Forfatterens mest brukte kommando er:
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Etter at programmeringsmodus startes, apnes nettsiden automatisk.

Du kan bruke claude direkte pa nettsiden, samtidig som du ser komplette foresporselssmeldinger og kodeendringer.

Og enda bedre — du kan faktisk programmere fra mobilenheten!


### Loggmodus

⚠️ Hvis du fortsatt foretrekker a bruke det opprinnelige claude-verktroyet eller VS Code-utvidelsen, bruk denne modusen.

I denne modusen vil oppstart av ```claude``` eller ```claude --dangerously-skip-permissions```

automatisk starte en loggprosess som registrerer forsporselslogger til ~/.claude/cc-viewer/*dittprosjekt*/dato.jsonl

Start loggmodus:
```bash
ccv -logger
```

Nar den spesifikke porten ikke kan skrives ut i konsollen, er standardporten for den forste instansen 127.0.0.1:7008. Flere samtidige instanser bruker pafolgende porter som 7009, 7010.

Denne kommandoen oppdager automatisk installasjonsmaten for Claude Code (NPM eller Native Install) og tilpasser seg deretter.

- **NPM-versjon av claude code**: Injiserer automatisk et avlyttingsskript i Claude Codes `cli.js`.
- **Native-versjon av claude code**: Oppdager automatisk `claude`-binarfilen, konfigurerer en lokal transparent proxy og setter opp en Zsh Shell Hook for automatisk trafikkvideresending.
- Dette prosjektet anbefaler bruk av Claude Code installert via NPM.

Avinstaller loggmodus:
```bash
ccv --uninstall
```

### Feilsoking (Troubleshooting)

Hvis du stoter pa oppstartsproblemer, finnes det en ultimate losning:
Steg 1: Apne Claude Code i en vilkarlig mappe;
Steg 2: Gi Claude Code folgende instruksjon:
```
Jeg har installert npm-pakken cc-viewer, men etter a ha kjort ccv fungerer det fortsatt ikke riktig. Se pa cli.js og findcc.js i cc-viewer, og tilpass den lokale Claude Code-distribusjonen basert pa det spesifikke miljoet. Begrens endringene til findcc.js sa langt det er mulig.
```
A la Claude Code selv sjekke feilene er mer effektivt enn a sporre noen eller lese dokumentasjon!

Etter at instruksjonene ovenfor er fullfort, vil findcc.js bli oppdatert. Hvis prosjektet ditt ofte krever lokal distribusjon, eller forket kode ofte trenger a lose installasjonsproblemer, kan du bare beholde denne filen og kopiere den direkte neste gang. I dag distribuerer mange prosjekter og selskaper Claude Code ikke pa Mac, men pa serversiden. Derfor har forfatteren skilt ut findcc.js for a gjore det enklere a folge oppdateringer i cc-viewer-kildekoden.

### Andre hjelpekommandoer

Se hjelp:
```bash
ccv -h
```

### Konfigurasjonsoverstyring (Configuration Override)

Hvis du trenger a bruke et tilpasset API-endepunkt (f.eks. bedriftsproxy), konfigurer det i `~/.claude/settings.json` eller sett miljoevariabelen `ANTHROPIC_BASE_URL`. `ccv` oppdager dette automatisk og videresender forsporsler korrekt.

### Stillemodus (Silent Mode)

Som standard kjorer `ccv` i stillemodus nar den wrapper `claude`, slik at terminalutskriften forblir ren og identisk med den opprinnelige opplevelsen. Alle logger fanges opp i bakgrunnen og er tilgjengelige via `http://localhost:7008`.

Etter at konfigurasjonen er fullfort, bruk `claude`-kommandoen som vanlig. Besok `http://localhost:7008` for a se overvaakingsgrensesnittet.


## Klientversjon

cc-viewer tilbyr en skrivebordsklientversjon som du kan laste ned fra GitHub.
[Nedlastingslenke](https://github.com/weiesky/cc-viewer/releases)
Klientversjonen er for oyeblikket i testfasen — hvis du stoter pa problemer, er du velkommen til a gi tilbakemelding nar som helst. Vær ogsa oppmerksom pa at forutsetningen for a bruke cc-viewer er at du har Claude Code installert lokalt.
Det er viktig a merke seg at cc-viewer alltid bare er et «klæsplagg» for arbeideren (Claude Code) — uten Claude Code kan ikke klærne fungere pa egen hand.

## Funksjoner


### Programmeringsmodus

Etter oppstart med ccv ser du:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Du kan se kode-diff direkte etter redigering:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Selv om du kan apne filer og programmere manuelt, anbefales det ikke — det er gammeldags programmering!

### Mobilprogrammering

Du kan til og med skanne en QR-kode for a programmere pa mobilenheten:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Oppfyller dine drommer om mobilprogrammering. I tillegg finnes det en plugin-mekanisme — hvis du vil tilpasse programmeringsopplevelsen, kan du folge med pa plugin-hooks-oppdateringer.

### Loggmodus (vis komplette Claude Code-samtaler)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Fanger opp alle API-forsporsler fra Claude Code i sanntid, og sikrer at det er originalteksten, ikke sensurerte logger (dette er veldig viktig!!!)
- Identifiserer og markerer automatisk Main Agent og Sub Agent-forsporsler (undertyper: Plan, Search, Bash)
- MainAgent-forsporsler stotter Body Diff JSON, viser forskjeller fra forrige MainAgent-foresporstel sammenfoldet (viser kun endrede/nye felt)
- Hver foresporstel viser inline Token-bruksstatistikk (inn-/ut-Token, cache-opprettelse/-lesing, treffrate)
- Kompatibel med Claude Code Router (CCR) og andre proxy-scenarier — matcher forsporsler via API-stimonster som reserve

### Samtalemodus

Klikk pa "Samtalemodus"-knappen overst til hoyre for a analysere Main Agents komplette samtalehistorikk som et chat-grensesnitt:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Stotter forelopig ikke visning av Agent Team
- Brukermeldinger hoyrejustert (bla boble), Main Agent-svar venstrejustert (mork boble)
- `thinking`-blokker er sammenfoldet som standard, gjengitt som Markdown. Klikk for a se tankeprosessen; stotter ett-klikks oversettelse (funksjonen er forelopig ustabil)
- Brukervalgmeldinger (AskUserQuestion) vises i sporsmal-svar-format
- Toveis modussynkronisering: Ved bytte til samtalemodus navigeres det automatisk til samtalen for den valgte forsporselen; ved bytte tilbake til originalmodus navigeres det automatisk til den valgte forsporselen
- Innstillingspanel: Kan endre standard sammenfolding for verktoyresultater og thinking-blokker
- Mobil samtalevisning: I mobil CLI-modus kan du trykke pa "Samtalevisning"-knappen i topplinjen for a apne en skrivebeskyttet samtalevisning og bla gjennom hele samtalehistorikken pa mobilen

### Statistikkverktoy

Svevepanel for "Datastatistikk" i header-omradet:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Viser antall cache creation/read og cache-treffrate
- Cache-gjenoppbyggingsstatistikk: Gruppert etter arsak (TTL, system/tools/model-endring, meldingsforkortelse/-endring, nokkelendring) med antall og cache_creation tokens
- Verktoybruksstatistikk: Viser anropsfrekvens for hvert verktoy, sortert etter antall
- Skill-bruksstatistikk: Viser anropsfrekvens for hver Skill, sortert etter antall
- Stotter teammate-statistikk
- Konsepthjelp (?)-ikoner: Klikk for a se innebygd dokumentasjon for MainAgent, CacheRebuild og hvert verktoy

### Logghandtering

Via CC-Viewer-rullegardinmenyen overst til venstre:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Loggkomprimering**
Om logger vil forfatteren presisere at ingen endringer er gjort i Anthropics offisielle definisjoner, for a sikre loggens integritet.
Men ettersom enkeltstaaende logger fra 1M opus blir svart store over tid, har forfatteren implementert loggoptimalisering for MainAgent som reduserer storrelsen med minst 66% uten gzip.
Metoden for a analysere disse komprimerte loggene kan hentes fra dette repositoryet.

### Flere nyttige funksjoner

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Du kan raskt finne prompten din via sidelinjen

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

Den interessante KV-Cache-Text-funksjonen lar deg se hva Claude faktisk ser

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Du kan laste opp bilder og beskrive behovene dine. Claude har svart sterk bildeforstaelse. Du kan ogsa lime inn skjermbilder direkte med Ctrl + V, og samtalen viser hele innholdet ditt

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Du kan tilpasse plugins direkte, administrere alle CC-Viewer-prosesser, og CC-Viewer har mulighet for hurtigbytte til tredjeparts-APIer (ja, du kan bruke GLM, Kimi, MiniMax, Qwen, DeepSeek — selv om forfatteren mener de alle er ganske svake forelopig)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Flere funksjoner venter pa a bli oppdaget... For eksempel: Systemet stotter Agent Team og har innebygd Code Reviewer. Snart kommer ogsa integrering av Codex sin Code Reviewer (forfatteren er en stor tilhenger av a bruke Codex til a reviewe Claude Code-kode)


### Automatiske oppdateringer

CC-Viewer sjekker automatisk etter oppdateringer ved oppstart (maksimalt en gang hver 4. time). Innenfor samme hovedversjon (f.eks. 1.x.x -> 1.y.z) oppdateres det automatisk, og endringen trer i kraft ved neste oppstart. Ved skifte av hovedversjon vises kun et varsel.

Automatisk oppdatering folger Claude Codes globale konfigurasjon `~/.claude/settings.json`. Hvis Claude Code har deaktivert automatiske oppdateringer (`autoUpdates: false`), hopper CC-Viewer ogsa over automatisk oppdatering.

### Flerspraklig stotte

CC-Viewer stotter 18 sprak og bytter automatisk basert pa systemspraket:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
