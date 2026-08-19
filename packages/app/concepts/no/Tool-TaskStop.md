# TaskStop

Stopper en kjørende bakgrunnsoppgave — en shell-kommando, en dispatchet agent eller en ekstern sesjon — ved hjelp av kjøretidshåndtaket. Bruk det for å frigjøre ressurser, avbryte arbeid som ikke lenger er nyttig, eller gjenopprette når en oppgave er fastlåst.

## Når skal den brukes

- En bakgrunns-shell-kommando har kjørt lenger enn forventet og du trenger ikke lenger resultatet.
- En lokal agent loop-er eller har stoppet opp og må avskjæres.
- Brukeren endret retning og bakgrunnsarbeid for forrige retning bør forlates.
- En ekstern sesjon er i ferd med å tidsavbryte eller holder en ressurs du trenger.
- Du trenger en ren tavle før du starter en ny kjøring av samme oppgave.

Foretrekk å la kortlivet bakgrunnsarbeid fullføre på egen hånd. `TaskStop` er for tilfeller der fortsatt utførelse ikke har noen verdi eller er aktivt skadelig.

## Parametere

- `task_id` (string, påkrevd): Kjøretidshåndtaket som returneres når bakgrunnsoppgaven ble startet. Dette er samme identifikator akseptert av `TaskOutput`, ikke en oppgaveliste-`taskId`.

## Eksempler

### Eksempel 1

Stopp en løpsk bakgrunns-shell-kommando.

```
TaskStop(task_id: "bash_01HXYZ...")
```

Kommandoen mottar et termineringssignal; bufret utdata skrevet så langt forblir lesbart på utdatastien.

### Eksempel 2

Avbryt en dispatchet agent etter en brukerkursjustering.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Notater

- `TaskStop` ber om terminering; det garanterer ikke øyeblikkelig nedstengning. Veloppførte oppgaver avsluttes raskt, men en prosess som gjør blokkerende I/O kan ta et øyeblikk å avvikle.
- Å stoppe en oppgave sletter ikke utdata dens. For bakgrunns-shell-oppgaver er utdatafilen på disken bevart og fortsatt lesbar med `Read`. For agenter og sesjoner er hvilken som helst utdata fanget opp før stoppet fortsatt tilgjengelig via `TaskOutput`.
- En ukjent `task_id`, eller en oppgave som allerede har avsluttet, returnerer en feil eller er en no-op. Dette er trygt — du kan kalle `TaskStop` defensivt uten å sjekke status først.
- Hvis du har tenkt å starte det samme arbeidet på nytt, stopp den gamle oppgaven før du dispatcher den nye for å unngå to parallelle kjøringer som konkurrerer om delte ressurser (filer, porter, databaserader).
- `TaskStop` påvirker ikke oppføringer i team-oppgavelisten. For å avbryte en sporet oppgave, oppdater status til `deleted` med `TaskUpdate`.
