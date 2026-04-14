# UltraPlan — Den Ultimative Onskemaskine

## Hvad er UltraPlan

UltraPlan er cc-viewers **lokaliserede implementering** af Claude Codes native `/ultraplan`-kommando. Det giver dig mulighed for at bruge de fulde funktioner i `/ultraplan` i dit lokale miljo **uden at skulle starte Claudes officielle fjerntjeneste**, og guider Claude Code til at udfoere komplekse planlaegnings- og implementeringsopgaver ved hjaelp af **multi-agent-samarbejde**.

Sammenlignet med den almindelige Plan-tilstand eller Agent Team kan UltraPlan:
- Tilbyder rollerne **Kodeekspert** og **Forskningsekspert** tilpasset forskellige opgavetyper
- Udsend flere parallelle agenter til at udforske kodebasen eller udføre research fra forskellige dimensioner
- Inkorporere ekstern research (webSearch) for branchens bedste praksisser
- Automatisk sammensaette et Code Review Team efter planens udfoerelse til kodegennemgang
- Danne en komplet **Plan → Execute → Review → Fix** lukket kredsloeb

---

## Vigtige Bemerkninger

### 1. UltraPlan Er Ikke Almaegtigt
UltraPlan er en mere kraftfuld onskemaskine, men det betyder ikke, at ethvert oenske kan opfyldes. Den er mere kraftfuld end Plan og Agent Team, men kan ikke direkte "tjene penge til dig". Overvej en rimelig opgavegranularitet — opdel store maal i udfoebare mellemstore opgaver i stedet for at proeve at opnaa alt paa en gang.

### 2. Aktuelt Mest Effektiv til Programmeringsprojekter
UltraPlans skabeloner og workflows er dybt optimeret til programmeringsprojekter. Andre scenarier (dokumentation, dataanalyse osv.) kan forsoges, men det kan vaere vaerd at vente paa tilpasninger i fremtidige versioner.

### 3. Koerselstid og Krav til Kontekstvindue
- En vellykket UltraPlan-koerelse tager typisk **30 minutter eller mere**
- Kraever at MainAgent har et stort kontekstvindue (1M context Opus-modellen anbefales)
- Hvis du kun har en 200K-model, **soerg for at `/clear` konteksten foer koerelse**
- Claude Codes `/compact` fungerer daarligt, naar kontekstvinduet er utilstraekkeligt — undgaa at loebe toer for plads
- At opretholde tilstraekkelig kontekstplads er en afgoerende forudsaetning for vellykket UltraPlan-udfoerelse

Hvis du har spoergsmaal eller forslag til den lokaliserede UltraPlan, er du velkommen til at aabne [Issues paa GitHub](https://github.com/anthropics/claude-code/issues) for at diskutere og samarbejde.

---

## Sådan fungerer det

UltraPlan tilbyder to ekspertroller, tilpasset forskellige opgavetyper:

### Kodeekspert
Et multi-agent samarbejdsworkflow designet til programmeringsprojekter:
1. Udsend op til 5 parallelle agenter til at udforske kodebasen samtidigt (arkitektur, filidentifikation, risikovurdering osv.)
2. Valgfrit: udsend en research-agent til at undersøge brancheløsninger via webSearch
3. Syntetiser alle agenternes fund til en detaljeret implementeringsplan
4. Udsend en review-agent til at granske planen fra flere perspektiver
5. Udfør planen efter godkendelse
6. Saml automatisk et Code Review Team til at validere kodekvaliteten efter implementeringen

### Forskningsekspert
Et multi-agent samarbejdsworkflow designet til research- og analyseopgaver:
1. Udsend flere parallelle agenter til at researche fra forskellige dimensioner (brancheundersøgelser, akademiske artikler, nyheder, konkurrentanalyse osv.)
2. Tildel en agent til at syntetisere målløsningen og samtidig verificere de indsamlede kilders stringens og troværdighed
3. Valgfrit: udsend en agent til at oprette en produktdemo (HTML, Markdown osv.)
4. Syntetiser alle fund til en omfattende implementeringsplan
5. Udsend flere review-agenter til at granske planen fra forskellige roller og perspektiver
6. Udfør planen efter godkendelse
