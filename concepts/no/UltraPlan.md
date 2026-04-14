# UltraPlan — Den Ultimate Ønskemaskinen

## Hva er UltraPlan

UltraPlan er cc-viewers **lokaliserte implementering** av Claude Codes native `/ultraplan`-kommando. Den lar deg bruke de fulle mulighetene til `/ultraplan` i ditt lokale miljø **uten å måtte starte Claudes offisielle fjerntjeneste**, og veileder Claude Code til å utføre komplekse planleggings- og implementeringsoppgaver ved hjelp av **multiagent-samarbeid**.

Sammenlignet med vanlig Plan-modus eller Agent Team, kan UltraPlan:
- Tilbyr rollene **Kodeekspert** og **Forskningsekspert** tilpasset ulike oppgavetyper
- Utplasser flere parallelle agenter for å utforske kodebasen eller utføre forskning fra ulike dimensjoner
- Inkludere ekstern forskning (webSearch) for bransjens beste praksis
- Automatisk sette sammen et Code Review Team etter plangjennomføring for kodegjennomgang
- Danne en komplett lukket sløyfe **Plan → Utfør → Gjennomgå → Fiks**

---

## Viktige merknader

### 1. UltraPlan er ikke allmektig
UltraPlan er en kraftigere ønskemaskin, men det betyr ikke at ethvert ønske kan oppfylles. Den er kraftigere enn Plan og Agent Team, men kan ikke direkte «tjene penger for deg». Vurder rimelig oppgavegranularitet — del store mål inn i gjennomførbare mellomstore oppgaver i stedet for å prøve å oppnå alt på en gang.

### 2. For øyeblikket mest effektiv for programmeringsprosjekter
UltraPlans maler og arbeidsflyter er dypt optimalisert for programmeringsprosjekter. Andre scenarier (dokumentasjon, dataanalyse osv.) kan prøves, men du bør kanskje vente på tilpasninger i fremtidige versjoner.

### 3. Utføringstid og krav til kontekstvindu
- En vellykket UltraPlan-kjøring tar vanligvis **30 minutter eller mer**
- Krever at MainAgent har et stort kontekstvindu (Opus-modell med 1M kontekst anbefales)
- Hvis du bare har en 200K-modell, **sørg for å kjøre `/clear` på konteksten før kjøring**
- Claude Codes `/compact` fungerer dårlig når kontekstvinduet er utilstrekkelig — unngå å gå tom for plass
- Å opprettholde tilstrekkelig kontekstplass er en kritisk forutsetning for vellykket UltraPlan-gjennomføring

Hvis du har spørsmål eller forslag om den lokaliserte UltraPlan, er du velkommen til å åpne [Issues på GitHub](https://github.com/anthropics/claude-code/issues) for å diskutere og samarbeide.

---

## Slik fungerer det

UltraPlan tilbyr to ekspertroller, tilpasset ulike oppgavetyper:

### Kodeekspert
En multi-agent samarbeidsarbeidsflyt designet for programmeringsprosjekter:
1. Utplasser opptil 5 parallelle agenter for å utforske kodebasen samtidig (arkitektur, filidentifikasjon, risikovurdering osv.)
2. Valgfritt: utplasser en forskningsagent for å undersøke bransjeløsninger via webSearch
3. Syntetiser alle agentenes funn til en detaljert implementeringsplan
4. Utplasser en gjennomgangsagent for å granske planen fra flere perspektiver
5. Utfør planen etter godkjenning
6. Automatisk sett sammen et Code Review Team for å validere kodekvaliteten etter implementering

### Forskningsekspert
En multi-agent samarbeidsarbeidsflyt designet for forsknings- og analyseoppgaver:
1. Utplasser flere parallelle agenter for å forske fra ulike dimensjoner (bransjeundersøkelser, akademiske artikler, nyheter, konkurrentanalyse osv.)
2. Tildel en agent for å syntetisere målløsningen og samtidig verifisere nøyaktigheten og troverdigheten til innsamlede kilder
3. Valgfritt: utplasser en agent for å lage en produktdemo (HTML, Markdown osv.)
4. Syntetiser alle funn til en omfattende implementeringsplan
5. Utplasser flere gjennomgangsagenter for å granske planen fra ulike roller og perspektiver
6. Utfør planen etter godkjenning
