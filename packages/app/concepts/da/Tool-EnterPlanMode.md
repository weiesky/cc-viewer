# EnterPlanMode

Skifter sessionen til plantilstand, en skrivebeskyttet udforskningsfase, hvor assistenten undersøger kodebasen og udarbejder en konkret implementeringsplan, som brugeren kan godkende, før filer ændres.

## Hvornår skal den bruges

- Brugeren beder om en ikke-triviel ændring, der spænder over flere filer eller undersystemer.
- Kravene er tvetydige, og assistenten skal læse kode, før den forpligter sig til en tilgang.
- En refaktorering, migration eller afhængighedsopgradering foreslås, og konsekvensradius er uklar.
- Brugeren siger udtrykkeligt "planlæg dette", "lad os planlægge først" eller anmoder om en designgennemgang.
- Risikoen er høj nok til, at det ville være spild af arbejde eller beskadige tilstanden at gå direkte til redigeringer.

## Parametre

Ingen. `EnterPlanMode` tager ingen argumenter — kald den med et tomt parameterobjekt.

## Eksempler

### Eksempel 1: Stor featureanmodning

Brugeren beder om: "Tilføj SSO via Okta til adminpanelet." Assistenten kalder `EnterPlanMode` og bruger derefter flere runder på at læse auth-middleware, session-storage, rute-guards og eksisterende login-UI. Den skriver en plan, der beskriver nødvendige ændringer, migrationstrin og testdækning, og indsender derefter via `ExitPlanMode` til godkendelse.

### Eksempel 2: Risikabel refaktorering

Brugeren siger: "Konvertér REST-controllerne til tRPC." Assistenten går i plantilstand, undersøger hver controller, katalogiserer den offentlige kontrakt, oplister udrulningsfaser (shim, dual-read, cutover) og foreslår en sekventeringsplan, før nogen fil berøres.

## Noter

- Plantilstand er skrivebeskyttet pr. kontrakt. Mens inde i den må assistenten ikke køre `Edit`, `Write`, `NotebookEdit` eller nogen muterende shell-kommando. Brug kun `Read`, `Grep`, `Glob` og ikke-destruktive `Bash`-kommandoer.
- Gå ikke i plantilstand for trivielle one-liner-redigeringer, rene researchspørgsmål eller opgaver, hvor brugeren allerede har specificeret ændringen i fuld detalje. Omkostningen skader mere, end den hjælper.
- Under Auto-tilstand frarådes plantilstand, medmindre brugeren udtrykkeligt beder om det — Auto-tilstand foretrækker handling frem for forudgående planlægning.
- Brug plantilstand til at reducere kurskorrektioner på dyrt arbejde. En fem-minutters plan sparer ofte en time med fejlretningsorienterede redigeringer.
- Når først i plantilstand, skal undersøgelsen fokusere på de dele af systemet, der faktisk vil ændre sig. Undgå udtømmende ture i dele af repoet, der ikke er relateret til opgaven.
- Selve planen bør skrives til disk på den sti, rammen forventer, så `ExitPlanMode` kan indsende den. Planen bør indeholde konkrete filstier, funktionsnavne og verifikationstrin, ikke vag hensigt.
- Brugeren kan afvise planen og bede om revisioner. Itererér inde i plantilstand, indtil planen accepteres; afslut først derefter.
