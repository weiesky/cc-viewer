# EnterPlanMode

Bytter sesjonen til planmodus, en lesebasert utforskningsfase der assistenten undersøker kodebasen og utarbeider en konkret implementasjonsplan som brukeren kan godkjenne før noen filer endres.

## Når skal den brukes

- Brukeren ber om en ikke-triviell endring som spenner over flere filer eller delsystemer.
- Krav er tvetydige og assistenten må lese kode før den forplikter seg til en tilnærming.
- En refaktorering, migrering eller avhengighetsoppgradering foreslås, og eksplosjonsradiusen er uklar.
- Brukeren sier eksplisitt "plan dette", "la oss planlegge først" eller ber om en designgjennomgang.
- Risikoen er høy nok til at det å gå rett til redigeringer kan bortkaste arbeid eller skade tilstand.

## Parametere

Ingen. `EnterPlanMode` tar ingen argumenter — kall den med et tomt parameter-objekt.

## Eksempler

### Eksempel 1: Stor funksjonsforespørsel

Brukeren spør: "Legg til SSO via Okta i admin-panelet." Assistenten kaller `EnterPlanMode`, og bruker deretter flere turer på å lese auth-mellomvare, øktlagring, rute-vaktere og eksisterende login-UI. Den skriver en plan som beskriver nødvendige endringer, migrasjonssteg og testdekning, og sender den inn via `ExitPlanMode` for godkjenning.

### Eksempel 2: Risikabel refaktorering

Brukeren sier: "Konverter REST-kontrollerne til tRPC." Assistenten går inn i planmodus, kartlegger hver kontroller, katalogiserer den offentlige kontrakten, lister opp utrullingsfaser (shim, dual-read, cutover) og foreslår en sekvensplan før noen fil berøres.

## Notater

- Planmodus er lesebasert som kontrakt. Mens den er aktiv, må ikke assistenten kjøre `Edit`, `Write`, `NotebookEdit` eller noen muterende shell-kommando. Bruk kun `Read`, `Grep`, `Glob` og ikke-destruktive `Bash`-kommandoer.
- Ikke gå inn i planmodus for trivielle enlinjersendringer, rene researchspørsmål, eller oppgaver der brukeren allerede har spesifisert endringen i full detalj. Overhead skader mer enn det hjelper.
- I Auto-modus frarådes planmodus med mindre brukeren eksplisitt ber om det — Auto-modus foretrekker handling fremfor planlegging på forhånd.
- Bruk planmodus for å redusere kursjusteringer på kostbart arbeid. En fem-minutters plan sparer ofte en time med feilrettede redigeringer.
- Når du først er i planmodus, fokuser undersøkelsen på de delene av systemet som faktisk vil endres. Unngå uttømmende rundturer i repoet som ikke er relatert til oppgaven.
- Selve planen bør skrives til disk på stien rammeverket forventer slik at `ExitPlanMode` kan sende den inn. Planen bør inneholde konkrete filbaner, funksjonsnavn og verifikasjonssteg, ikke vag intensjon.
- Brukeren kan avvise planen og be om revisjoner. Iterer inne i planmodus til planen er akseptert; først da avslutter du.
