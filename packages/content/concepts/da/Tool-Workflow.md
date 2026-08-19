# Workflow

Kører et script, der deterministisk orkestrerer mange underagenter — fan-out, pipelines, løkker og verifikation — til arbejde, der er for bredt, for usikkert eller for stort til en enkelt kontekst.

## Hvornår skal det bruges

- Nedbryd en stor opgave og dæk den parallelt på tværs af mange agenter
- Krydstjek fund med uafhængig eller adversarial verifikation, før du fæster lid til dem
- Tag fat på skala, som én kontekst ikke kan rumme: migreringer, audits, brede gennemløb af mange filer

## Sådan fungerer det

- Kører i baggrunden; du får besked, når det er færdigt. Følg den løbende fremdrift med `/workflows`.
- Scriptet koordinerer agenter med `agent()`, `parallel()`, `pipeline()` og `phase()`.
- `pipeline()` streamer hvert element gennem stadierne uden barriere (standard); `parallel()` er en barriere, der venter på alle resultater.
- Med et schema returnerer hvert `agent()` valideret struktureret data i stedet for fri tekst.

## Noter

- Kører kun, når brugeren udtrykkeligt vælger orkestrering med flere agenter; det kan starte mange agenter og forbruge betydelige tokens.
- Samtidigheden er begrænset pr. workflow; overskydende agenter sættes i kø og kører, efterhånden som pladser bliver ledige.
- Til en enkelt underagent skal du bruge `Agent`-værktøjet i stedet — gem Workflow til reel fan-out.

## Relaterede begreber

- Bygger på `Agent`-værktøjet og kører mange agenter under deterministisk kontrolflow.
