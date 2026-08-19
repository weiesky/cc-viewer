# Workflow

Kjører et skript som deterministisk orkestrerer mange underagenter — fan-out, pipelines, løkker og verifisering — for arbeid som er for bredt, for usikkert eller for stort for én enkelt kontekst.

## Når skal det brukes

- Bryt ned en stor oppgave og dekk den parallelt på tvers av mange agenter
- Kryssjekk funn med uavhengig eller adversariell verifisering før du fester lit til dem
- Ta på deg skala som én kontekst ikke kan romme: migreringer, revisjoner, brede gjennomganger av mange filer

## Slik fungerer det

- Kjører i bakgrunnen; du får beskjed når det er ferdig. Følg fremdriften i sanntid med `/workflows`.
- Skriptet koordinerer agenter med `agent()`, `parallel()`, `pipeline()` og `phase()`.
- `pipeline()` streamer hvert element gjennom stadiene uten barriere (standard); `parallel()` er en barriere som venter på alle resultater.
- Med et schema returnerer hvert `agent()` validerte strukturerte data i stedet for fri tekst.

## Notater

- Kjører bare når brukeren uttrykkelig velger orkestrering med flere agenter; det kan starte mange agenter og bruke betydelige tokens.
- Samtidigheten er begrenset per workflow; overskytende agenter settes i kø og kjøres etter hvert som plasser blir ledige.
- For én enkelt underagent bruker du `Agent`-verktøyet i stedet — reserver Workflow for reell fan-out.

## Relaterte begreper

- Bygger på `Agent`-verktøyet og kjører mange agenter under deterministisk kontrollflyt.
