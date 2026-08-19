# CronCreate

Planlegger at en prompt settes i kø på et fremtidig tidspunkt, enten som engangsutførelse eller som gjentagende oppgave. Bruker standard 5-felts cron-syntaks i brukerens lokale tidssone — ingen tidssonekonvertering er nødvendig.

## Når skal den brukes

- **Engangs-påminnelser**: Når en bruker ønsker å bli påminnet på et bestemt tidspunkt ("påminn meg i morgen kl. 15"). Med `recurring: false` slettes oppgaven automatisk etter utførelse.
- **Gjentagende tidsplaner**: Når noe skal utføres gjentatte ganger ("hver hverdag kl. 9", "hvert 30. minutt"). Standardverdien `recurring: true` dekker dette tilfellet.
- **Autonome agent-løkker**: For arbeidsflyter som skal aktivere seg selv etter en tidsplan — f.eks. daglige sammendrag eller periodiske statuskontroller.
- **Varige oppgaver**: Når tidsplanen må overleve en omstart av sesjonen. Med `durable: true` lagres oppgaven i `.claude/scheduled_tasks.json`.
- **Omtrentlige tidspunkter**: Når brukeren sier "rundt kl. 9" eller "hver time", bør man velge en forskjøvet minuttverdi (f.eks. `57 8 * * *` eller `7 * * * *`) for å unngå at mange brukere aktiverer på :00 eller :30 samtidig.

## Parametere

- `cron` (string, påkrevd): 5-felts cron-uttrykk i brukerens lokale tidssone. Format: `minutt time dag-i-måneden måned ukedag`. Eksempel: `"0 9 * * 1-5"` betyr mandag–fredag kl. 9:00.
- `prompt` (string, påkrevd): Promptteksten som settes i kø når cron utløses — den eksakte meldingen som sendes til REPL på det planlagte tidspunktet.
- `recurring` (boolean, valgfri, standard `true`): Med `true` kjøres jobben ved hvert samsvarende cron-intervall og utløper automatisk etter 7 dager. Med `false` kjøres jobben nøyaktig én gang og slettes deretter — for engangs-påminnelser.
- `durable` (boolean, valgfri, standard `false`): Med `false` lever tidsplanen bare i minnet og forsvinner når sesjonen avsluttes. Med `true` lagres oppgaven i `.claude/scheduled_tasks.json` og overlever omstarter.

## Eksempler

### Eksempel 1: engangs-påminnelse

Brukeren sier: "Påminn meg i morgen kl. 14:30 om å sende den ukentlige rapporten." Anta at i morgen er 21. april:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Påminnelse: send den ukentlige rapporten nå.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` sikrer at oppgaven sletter seg selv etter utførelse. `durable: true` bevarer den gjennom eventuelle omstarter.

### Eksempel 2: gjentagende hverdags-morgenoppgave

Brukeren sier: "Oppsummer åpne GitHub-saker tildelt meg hver hverdag om morgenen."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Oppsummer alle åpne GitHub-saker tildelt meg.",
  "recurring": true,
  "durable": true
}
```

Minutt `3` i stedet for `0` unngår belastningstoppen ved heltimer. Jobben utløper automatisk etter 7 dager.

## Notater

- **Automatisk utløp etter 7 dager**: Gjentagende jobber slettes automatisk etter maksimalt 7 dager. Gjenskap oppgaven før den utløper for lengre tidsplaner.
- **Utløses bare i tomgang**: `CronCreate` setter prompten i kø bare når REPL ikke behandler en annen forespørsel. Hvis REPL er opptatt ved utløsningstidspunktet, venter prompten til den gjeldende forespørselen er ferdig.
- **Unngå :00 og :30**: For omtrentlige tidspunkter bør man bevisst velge forskjøvede minutteverdier for å fordele systembelastningen. Reserver :00/:30 for tilfeller der brukeren oppgir det eksakte minuttet.
- **Ingen tidssonekonvertering**: Cron-uttrykket tolkes direkte i brukerens lokale tidssone. Det er ikke nødvendig å konvertere til UTC eller en annen tidssone.
