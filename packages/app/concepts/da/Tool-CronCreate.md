# CronCreate

Planlæg et prompt til at blive sat i kø på et fremtidigt tidspunkt, enten som en enkelt udførelse eller som en tilbagevendende opgave. Anvender standard 5-felt cron-syntaks i brugerens lokale tidszone — ingen tidszonekonvertering er nødvendig.

## Hvornår skal den bruges

- **Engangs-påmindelser**: Når en bruger vil mindes om noget på et bestemt tidspunkt ("mind mig om det i morgen kl. 15"). Med `recurring: false` slettes opgaven automatisk efter udførelse.
- **Tilbagevendende tidsplaner**: Når noget skal udføres gentagne gange ("hver hverdag kl. 9", "hvert 30. minut"). Standardværdien `recurring: true` dækker dette tilfælde.
- **Autonome agent-løkker**: Til arbejdsgange der skal genaktivere sig selv efter en tidsplan — f.eks. daglige resuméer eller periodiske statustjek.
- **Varige opgaver**: Når tidsplanen skal overleve en sessionsgenstart. Med `durable: true` gemmes opgaven i `.claude/scheduled_tasks.json`.
- **Omtrentlige tidspunkter**: Når brugeren siger "omkring kl. 9" eller "hver time", bør man vælge en forskudt minutværdi (f.eks. `57 8 * * *` eller `7 * * * *`) for at undgå at mange brugere aktiverer på :00 eller :30 samtidigt.

## Parametre

- `cron` (string, påkrævet): 5-felt cron-udtryk i brugerens lokale tidszone. Format: `minut time dag-i-måneden måned ugedag`. Eksempel: `"0 9 * * 1-5"` betyder mandag–fredag kl. 9:00.
- `prompt` (string, påkrævet): Den prompttekst, der sættes i kø, når cron udløses — den præcise besked, der sendes til REPL på det planlagte tidspunkt.
- `recurring` (boolean, valgfri, standard `true`): Med `true` køres jobbet ved hvert matchende cron-interval og udløber automatisk efter 7 dage. Med `false` køres jobbet præcis én gang og slettes derefter — til engangs-påmindelser.
- `durable` (boolean, valgfri, standard `false`): Med `false` lever tidsplanen kun i hukommelsen og forsvinder, når sessionen afsluttes. Med `true` gemmes opgaven i `.claude/scheduled_tasks.json` og overlever genstarter.

## Eksempler

### Eksempel 1: engangs-påmindelse

Brugeren siger: "Mind mig om at sende den ugentlige rapport i morgen kl. 14:30." Hvis i morgen er den 21. april:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Påmindelse: send den ugentlige rapport nu.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` sikrer, at opgaven sletter sig selv efter udførelse. `durable: true` bevarer den på tværs af eventuelle genstarter inden da.

### Eksempel 2: tilbagevendende hverdagsmorgen-opgave

Brugeren siger: "Opsummer mine åbne GitHub-issues hver hverdag om morgenen."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Opsummer alle åbne GitHub-issues tildelt mig.",
  "recurring": true,
  "durable": true
}
```

Minut `3` i stedet for `0` undgår belastningsspidsen på heltimer. Jobbet udløber automatisk efter 7 dage.

## Noter

- **Automatisk udløb efter 7 dage**: Tilbagevendende job slettes automatisk efter højst 7 dage. Genskab opgaven inden udløbet, hvis du har brug for en længere tidsplan.
- **Udløses kun i tomgang**: `CronCreate` sætter prompten i kø kun når REPL ikke behandler en anden forespørgsel. Hvis REPL er optaget på udløsningstidspunktet, venter prompten til den aktuelle forespørgsel er afsluttet.
- **Undgå :00 og :30**: For omtrentlige tidspunkter bør man bevidst vælge forskudte minutværdier for at fordele systembelastningen. Reserver :00/:30 kun til tilfælde, hvor brugeren angiver det præcise minut.
- **Ingen tidszonekonvertering**: Cron-udtrykket fortolkes direkte i brugerens lokale tidszone. Der er ikke behov for at konvertere til UTC eller en anden tidszone.
