# CC-Viewer

Claude Code anmodningsovervågningssystem, der fanger og visualiserer alle API-anmodninger og -svar fra Claude Code i realtid (original tekst, uden beskæring). Praktisk for udviklere til at overvåge deres Context og gennemgå samt fejlfinde problemer under Vibe Coding.
Den nyeste version af CC-Viewer tilbyder også løsninger til serverbaseret webprogrammering samt værktøjer til mobilprogrammering. Du er velkommen til at bruge det i dine egne projekter. Fremover vil der blive åbnet for flere plugin-funktioner og understøttelse af cloud-deployment.

Lad os starte med den interessante del. Her er hvad du kan se på mobilen:

<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

[English](../README.md) | [简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | Dansk | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Sådan bruges det

### Installation

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### Programmeringstilstand

ccv er en direkte stedfortræder for claude. Alle parametre sendes videre til claude, og samtidig startes Web Viewer.

```bash
ccv                    # == claude (interaktiv tilstand)
ccv -c                 # == claude --continue (fortsæt forrige samtale)
ccv -r                 # == claude --resume (genoptag samtale)
ccv -p "hello"         # == claude --print "hello" (udskriftstilstand)
ccv --d                # == claude --dangerously-skip-permissions (genvej)
ccv --model opus       # == claude --model opus
```

Forfatterens mest brugte kommando er
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

Når programmeringstilstand starter, åbnes websiden automatisk.

Du kan bruge claude direkte på websiden, se de komplette anmodningsmeddelelser og gennemgå kodeændringer.

Og endnu mere imponerende: du kan endda programmere fra din mobilenhed!


### Logger-tilstand

⚠️ Hvis du stadig foretrækker at bruge claudes native værktøj eller VS Code-plugin, brug denne tilstand.

I denne tilstand startes ```claude``` eller ```claude --dangerously-skip-permissions```

En logproces startes automatisk, som registrerer anmodningslogs i ~/.claude/cc-viewer/*ditprojekt*/date.jsonl

Start logger-tilstand:
```bash
ccv -logger
```

Hvis konsollen ikke kan vise den specifikke port, er standardporten for den første instans 127.0.0.1:7008. Flere samtidige instanser fortsætter i rækkefølge, f.eks. 7009, 7010.

Denne kommando registrerer automatisk den lokale Claude Code-installationsmetode (NPM eller Native Install) og tilpasser sig derefter.

- **NPM-version af claude code**: Injicerer automatisk et aflytningsscript i Claude Codes `cli.js`.
- **Native version af claude code**: Registrerer automatisk `claude`-binæren, konfigurerer en lokal transparent proxy og opsætter Zsh Shell Hook til automatisk trafikvidersendelse.
- Dette projekt anbefaler at bruge claude code installeret via npm.

Afinstaller logger-tilstand:
```bash
ccv --uninstall
```

### Fejlfinding (Troubleshooting)

Hvis du oplever problemer med at starte, er her den ultimative løsning:
Trin 1: Åbn claude code i en vilkårlig mappe;
Trin 2: Giv claude code følgende instruktion:
```
Jeg har installeret cc-viewer npm-pakken, men efter at have kørt ccv virker det stadig ikke korrekt. Tjek cc-viewer's cli.js og findcc.js, og tilpas til den lokale claude code-installationsmetode baseret på det specifikke miljø. Begræns ændringerne så vidt muligt til findcc.js.
```
At lade Claude Code selv tjekke fejlen er mere effektivt end at spørge nogen eller læse nogen dokumentation!

Når ovenstående instruktion er fuldført, opdateres findcc.js. Hvis dit projekt ofte kræver lokal deployment, eller hvis forked kode ofte skal løse installationsproblemer, kan du beholde denne fil. Næste gang kopierer du bare filen. I dag bruger mange projekter og virksomheder claude code ikke på Mac, men med server-hosting. Derfor har forfatteren adskilt findcc.js-filen, så det er nemmere at følge cc-viewer kildekodeopdateringer.

### Andre hjælpekommandoer

Reference
```bash
ccv -h
```

### Konfigurationstilsidesættelse (Configuration Override)

Hvis du skal bruge et brugerdefineret API-endpoint (f.eks. virksomhedsproxy), skal du blot konfigurere det i `~/.claude/settings.json` eller angive miljøvariablen `ANTHROPIC_BASE_URL`. `ccv` genkender og videresender anmodninger korrekt automatisk.

### Stille tilstand (Silent Mode)

Som standard kører `ccv` i stille tilstand, når den wrapper `claude`, og sikrer at dit terminaloutput forbliver rent og konsistent med den native oplevelse. Alle logs fanges i baggrunden og kan ses via `http://localhost:7008`.

Når konfigurationen er færdig, bruger du bare `claude`-kommandoen som normalt. Besøg `http://localhost:7008` for at se overvågningsgrænsefladen.


## Klientversion

cc-viewer tilbyder en desktopklientversion, som du kan downloade fra GitHub.
[Download-link](https://github.com/weiesky/cc-viewer/releases)
Klientversionen er i øjeblikket i testfasen — hvis du støder på problemer, er du velkommen til at give feedback når som helst. Bemærk desuden, at forudsætningen for at bruge cc-viewer er, at du har Claude Code installeret lokalt.
Det er vigtigt at forstå, at cc-viewer altid kun er et "sæt tøj" til arbejderen (Claude Code) — uden Claude Code kan tøjet ikke fungere alene.

## Funktioner


### Programmeringstilstand

Efter start med ccv kan du se:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


Du kan se kode-diff direkte efter redigering:

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

Du kan åbne filer og programmere manuelt, men det anbefales ikke — det er programmering på den gammeldags måde!

### Mobilprogrammering

Du kan endda scanne en QR-kode for at programmere på din mobilenhed:

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

Opfylder din forestilling om mobilprogrammering. Derudover er der en plugin-mekanisme — hvis du har brug for at tilpasse det til dine programmeringsvaner, kan du følge med i plugin hooks-opdateringerne fremover.

### Logger-tilstand (se komplette claude code-sessioner)

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- Fanger alle API-anmodninger fra Claude Code i realtid og sikrer, at det er den originale tekst — ikke beskårne logs (dette er meget vigtigt!!!)
- Identificerer og markerer automatisk Main Agent- og Sub Agent-anmodninger (undertyper: Plan, Search, Bash)
- MainAgent-anmodninger understøtter Body Diff JSON med foldbar visning af forskelle fra den forrige MainAgent-anmodning (viser kun ændrede/nye felter)
- Inline Token-forbrugsstatistik for hver anmodning (input/output Token, cache creation/read, hitratio)
- Kompatibel med Claude Code Router (CCR) og andre proxy-scenarier — fallback-matching via API-stimønstre

### Samtaletilstand

Klik på knappen "Samtaletilstand" i øverste højre hjørne for at parse Main Agents komplette samtalehistorik til en chatgrænseflade:

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />


- Visning af Agent Team understøttes ikke endnu
- Brugermeddelelser er højrejusterede (blå bobler), Main Agent-svar er venstrejusterede (mørke bobler)
- `thinking`-blokke er som standard foldet sammen, renderet i Markdown — klik for at udvide og se tankeprocessen; étklikoversættelse understøttes (funktionen er stadig ustabil)
- Brugervalgsmeddelelser (AskUserQuestion) vises i spørgsmål-svar-format
- Tovejs modesynkronisering: Skift til samtaletilstand springer automatisk til samtalen for den valgte anmodning; skift tilbage til originaltilstand springer automatisk til den valgte anmodning
- Indstillingspanel: Skift standardfoldningstilstand for værktøjsresultater og tænkningsblokke
- Mobilsamtalebrowsing: I mobil CLI-tilstand kan du trykke på knappen "Samtalebrowsing" i topbjælken for at åbne en skrivebeskyttet samtalevisning og gennemse den komplette samtalehistorik på mobilen

### Statistikværktøjer

Svævepanelet "Datastatistik" i Header-området:

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/a3d2db47-eac3-463a-9b44-3fa64994bf3b" />

- Viser cache creation/read-antal og cache-hitratio
- Cache-genopbygningsstatistik: Grupperet efter årsag (TTL, system/tools/model-ændringer, meddelelsestilskæring/-ændring, key-ændring) med antal og cache_creation tokens
- Værktøjsforbrugsstatistik: Viser hvert værktøjs kaldfrekvens sorteret efter antal kald
- Skill-forbrugsstatistik: Viser hver Skills kaldfrekvens sorteret efter antal kald
- Understøtter teammate-statistik
- Koncepthjælp (?)-ikon: Klik for at se den indbyggede dokumentation for MainAgent, CacheRebuild og hvert værktøj

### Log-håndtering

Via CC-Viewer-rullemenuen i øverste venstre hjørne:
<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**Log-komprimering**
Angående logs vil forfatteren gerne fremhæve, at der garanteret ikke er ændret på Anthropics officielle definitioner for at sikre logintegriteten.
Men da enkeltstående logs fra 1M opus i den sene fase bliver ekstremt store, har forfatteren takket være visse logoptimeringer for MainAgent opnået mindst 66% størrelsesreduktion uden gzip.
Parsingsmetoden for disse komprimerede logs kan udtrækkes fra det aktuelle repository.

### Flere praktiske og nyttige funktioner

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

Du kan hurtigt finde dine prompts via sidebjælkeværktøjerne

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

Den interessante KV-Cache-Text hjælper dig med at se, hvad Claude ser

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

Du kan uploade billeder og beskrive dine behov. Claudes billedforståelse er ekstremt kraftfuld. Derudover kan du tage et skærmbillede og indsætte det direkte med Ctrl + V, og samtalen viser dit fulde indhold

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

Du kan tilpasse plugins direkte, administrere alle CC-Viewer-processer, og CC-Viewer har hot-swap-funktionalitet til tredjepartsgrænseflader (ja, du kan bruge GLM, Kimi, MiniMax, Qwen, DeepSeek — selvom forfatteren mener, at de alle er ret svage i øjeblikket)

---


<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

Flere funktioner venter på at blive opdaget... f.eks.: Systemet understøtter Agent Team og har en indbygget Code Reviewer. Codex Code Reviewer-integration er lige rundt om hjørnet (forfatteren anbefaler stærkt at bruge Codex til at lave code review af Claude Code)


### Automatisk opdatering

CC-Viewer tjekker automatisk for opdateringer ved start (højst én gang hver 4. time). Inden for samme hovedversion (f.eks. 1.x.x → 1.y.z) opdateres automatisk og træder i kraft ved næste start. På tværs af hovedversioner vises kun en notifikation.

Automatisk opdatering følger Claude Codes globale konfiguration `~/.claude/settings.json`. Hvis Claude Code har deaktiveret automatiske opdateringer (`autoUpdates: false`), springer CC-Viewer også automatisk opdatering over.

### Flersprogsunderstøttelse

CC-Viewer understøtter 18 sprog og skifter automatisk baseret på systemets sprogindstilling:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
