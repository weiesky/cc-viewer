# TaskOutput

Henter den akkumulerte utdataen fra en kjørende eller fullført bakgrunnsoppgave — en bakgrunns-shell-kommando, en lokal agent eller en ekstern sesjon. Bruk det når du trenger å inspisere hva en langvarig oppgave har produsert så langt.

## Når skal den brukes

- En ekstern sesjon (for eksempel en cloud sandbox) kjører og du trenger dens stdout.
- En lokal agent ble dispatchet i bakgrunnen og du vil ha delvis fremgang før den returnerer.
- En bakgrunns-shell-kommando har kjørt lenge nok til at du vil sjekke den uten å stoppe den.
- Du må bekrefte at en bakgrunnsoppgave faktisk gjør fremgang før du venter lenger eller kaller `TaskStop`.

Ikke strekk deg etter `TaskOutput` refleksivt. For det meste av bakgrunnsarbeid finnes en mer direkte vei — se notatene nedenfor.

## Parametere

- `task_id` (string, påkrevd): Oppgaveidentifikatoren som returneres når bakgrunnsarbeidet ble startet. Ikke det samme som en oppgavelistes `taskId`; dette er kjøretidshåndtaket for den spesifikke utførelsen.
- `block` (boolean, valgfri): Når `true` (standard), vent til oppgaven produserer ny utdata eller avslutter før den returnerer. Når `false`, returner umiddelbart med det som er bufret.
- `timeout` (number, valgfri): Maksimalt antall millisekunder å blokkere før returnering. Kun meningsfull når `block` er `true`. Standard `30000`, maksimum `600000`.

## Eksempler

### Eksempel 1

Kikk på en ekstern sesjon uten å blokkere.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Returnerer hvilken som helst stdout/stderr som har blitt produsert siden oppgaven startet (eller siden ditt siste `TaskOutput`-kall, avhengig av kjøretiden).

### Eksempel 2

Vent kort på at en lokal agent sender ut mer utdata.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Notater

- Bakgrunns-bash-kommandoer: `TaskOutput` er effektivt avviklet for dette bruksområdet. Når du starter en bakgrunns-shell-oppgave inkluderer resultatet allerede stien til utdatafilen dens — les den stien direkte med `Read`-verktøyet. `Read` gir deg vilkårlig tilgang, linjeoffsets og en stabil visning; `TaskOutput` gjør ikke det.
- Lokale agenter (`Agent`-verktøyet dispatchet i bakgrunnen): når agenten fullføres, inneholder `Agent`-verktøyresultatet allerede det endelige svaret. Bruk det direkte. Ikke `Read` den symlinkede transkripsjonsfilen — den inneholder hele verktøykall-strømmen og vil overfylle kontekstvinduet.
- Eksterne sesjoner: `TaskOutput` er den korrekte og ofte eneste måten å strømme tilbake utdata. Foretrekk `block: true` med en moderat `timeout` fremfor tette polling-loops.
- En ukjent `task_id`, eller en oppgave hvis utdata har blitt søppelsamlet, returnerer en feil. Dispatch arbeidet på nytt hvis du fortsatt trenger det.
- `TaskOutput` stopper ikke oppgaven. Bruk `TaskStop` for å avslutte.
