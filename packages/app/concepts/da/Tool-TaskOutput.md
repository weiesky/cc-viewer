# TaskOutput

Henter det akkumulerede output fra en kørende eller fuldført baggrundsopgave — en baggrunds-shell-kommando, en lokal agent eller en fjernsession. Brug den, når du har brug for at inspicere, hvad en langvarig opgave har produceret indtil videre.

## Hvornår skal den bruges

- En fjernsession (for eksempel en cloud-sandbox) kører, og du har brug for dens stdout.
- En lokal agent blev sendt i baggrunden, og du vil have delvise fremskridt, før den returnerer.
- En baggrunds-shell-kommando har kørt længe nok til, at du vil tjekke op på den uden at stoppe den.
- Du har brug for at bekræfte, at en baggrundsopgave faktisk gør fremskridt, før du venter længere eller kalder `TaskStop`.

Ræk ikke refleksivt efter `TaskOutput`. For det meste baggrundsarbejde er der en mere direkte sti — se noterne nedenfor.

## Parametre

- `task_id` (string, påkrævet): Opgave-identifikatoren returneret, da baggrundsarbejdet blev startet. Ikke det samme som et task-list `taskId`; dette er runtime-håndtaget for den specifikke eksekvering.
- `block` (boolean, valgfri): Når `true` (standard), vent indtil opgaven producerer nyt output eller afsluttes, før der returneres. Når `false`, returnér straks med det, der er bufret.
- `timeout` (number, valgfri): Maksimum millisekunder at blokere, før der returneres. Kun meningsfuld, når `block` er `true`. Standard `30000`, maksimum `600000`.

## Eksempler

### Eksempel 1

Kig på en fjernsession uden at blokere.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Returnerer det stdout/stderr, der er produceret, siden opgaven startede (eller siden dit sidste `TaskOutput`-kald, afhængigt af runtime).

### Eksempel 2

Vent kort på, at en lokal agent udsender mere output.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Noter

- Baggrunds-bash-kommandoer: `TaskOutput` er reelt forældet til dette brug. Når du starter en baggrunds-shell-opgave, inkluderer resultatet allerede stien til dens outputfil — læs den sti direkte med `Read`-værktøjet. `Read` giver dig random access, linjeoffsets og en stabil visning; det gør `TaskOutput` ikke.
- Lokale agenter (`Agent`-værktøjet udsendt i baggrunden): når agenten er færdig, indeholder `Agent`-værktøjsresultatet allerede dens endelige svar. Brug det direkte. Læs ikke den symlinkede transkriptfil — den indeholder den fulde værktøjskaldsstrøm og vil overfylde kontekstvinduet.
- Fjernsessioner: `TaskOutput` er den korrekte og ofte eneste måde at streame output tilbage på. Foretræk `block: true` med en moderat `timeout` frem for stramme polling-løkker.
- Et ukendt `task_id` eller en opgave, hvis output er blevet garbage-collected, returnerer en fejl. Udsend arbejdet igen, hvis du stadig har brug for det.
- `TaskOutput` stopper ikke opgaven. Brug `TaskStop` til at afslutte.
