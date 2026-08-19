# TaskStop

Stopper en kørende baggrundsopgave — en shell-kommando, en udsendt agent eller en fjernsession — efter dens runtime-håndtag. Brug den til at frigive ressourcer, annullere arbejde, der ikke længere er nyttigt, eller komme på fode igen, når en opgave sidder fast.

## Hvornår skal den bruges

- En baggrunds-shell-kommando har kørt længere end forventet, og du har ikke længere brug for dens resultat.
- En lokal agent looper eller er gået i stå og skal afkortes.
- Brugeren har skiftet retning, og baggrundsarbejde for den tidligere retning bør opgives.
- En fjernsession er ved at time ud eller holder en ressource, du har brug for.
- Du har brug for en ren tavle, før du starter en ny kørsel af den samme opgave.

Foretræk at lade kortvarigt baggrundsarbejde blive færdigt af sig selv. `TaskStop` er til tilfælde, hvor fortsat eksekvering ingen værdi har eller er aktivt skadelig.

## Parametre

- `task_id` (string, påkrævet): Runtime-håndtaget returneret, da baggrundsopgaven blev startet. Dette er den samme identifikator, som `TaskOutput` accepterer, ikke et task-list `taskId`.

## Eksempler

### Eksempel 1

Stop en løbsk baggrunds-shell-kommando.

```
TaskStop(task_id: "bash_01HXYZ...")
```

Kommandoen modtager et terminate-signal; bufret output skrevet indtil nu forbliver læsbart ved dens outputsti.

### Eksempel 2

Annuller en udsendt agent efter en brugerkurskorrektion.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Noter

- `TaskStop` anmoder om afslutning; den garanterer ikke øjeblikkelig nedlukning. Velopdragne opgaver afslutter omgående, men en proces, der laver blokerende I/O, kan tage et øjeblik om at afvikle sig.
- Stop af en opgave sletter ikke dens output. For baggrunds-shell-opgaver er outputfilen på disken bevaret og stadig læsbar med `Read`. For agenter og sessioner er det, der blev fanget før stoppet, stadig tilgængeligt via `TaskOutput`.
- Et ukendt `task_id` eller en opgave, der allerede er afsluttet, returnerer en fejl eller en no-op. Dette er sikkert — du kan kalde `TaskStop` defensivt uden at tjekke status først.
- Hvis du har til hensigt at genstarte det samme arbejde, stop den gamle opgave, før du sender den nye, for at undgå, at to parallelle kørsler løber om kap om delte ressourcer (filer, porte, databaserækker).
- `TaskStop` påvirker ikke poster i teamets opgaveliste. For at annullere en sporet opgave opdater dens status til `deleted` med `TaskUpdate`.
