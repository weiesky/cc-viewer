# Monitor

Starter en baggrundsmonitor, der streamer hændelser fra et langvarigt script. Hver linje i standardoutput bliver en notifikation — fortsæt med at arbejde, mens hændelser ankommer i chatten.

## Hvornår skal den bruges

- Overvåge fejl, advarsler eller nedbrudsignaturer i en logfil, mens et deployment kører
- Forespørge en fjern-API, en PR eller en CI-pipeline hvert 30. sekund for at opdage nye statushændelser
- Holde øje med ændringer i en filsystemmappe eller byggeutput i realtid
- Vente på en specifik betingelse over mange iterationer (f.eks. en milepæl for et træningsskridt eller tømning af en kø)
- **Ikke** til simpel "vent til færdig" — brug `Bash` med `run_in_background` til det; det udsender én afslutningsnotifikation, når processen afsluttes

## Aktivering

- Slået fra som standard (server-side feature-flag).
- Ikke tilgængelig på Amazon Bedrock, Google Cloud og Microsoft Foundry.
- Slået fra, når `DISABLE_TELEMETRY` eller `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` er sat.
- WebSocket-kilden kræver Claude Code 2.1.195+.

## Parametre

- `command` (streng, påkrævet): Den shell-kommando eller det script, der skal køres. Hver linje skrevet til standardoutput bliver en separat notifikationshændelse. Monitoren slutter, når processen afsluttes.
- `description` (streng, påkrævet): En kort læsbar etiket vist i hver notifikation. Vær specifik — "fejl i deploy.log" er bedre end "overvåger logs". Denne etiket identificerer, hvilken monitor der blev udløst.
- `timeout_ms` (tal, standard `300000`, maks `3600000`): Afslutningsfrist i millisekunder. Efter denne varighed afsluttes processen tvungent. Ignoreres når `persistent: true`.
- `persistent` (boolsk, standard `false`): Når `true`, kører monitoren hele sessionens levetid uden timeout. Stop den eksplicit med `TaskStop`.

## Eksempler

### Eksempel 1: Overvåge en logfil for fejl og nedbrud

Dette eksempel dækker alle terminaltilstande: succesmarkør, traceback, almindelige fejlnøgleord, OOM-afslutning og uventet procesafslutning.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Brug `grep --line-buffered` i alle pipes. Uden det bufferlagrer operativsystemet output i 4 KB-blokke, og hændelser kan forsinkes i minutter. Alternationsmønsteret dækker både succesvejen (`deployed`) og fejlveje (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). En monitor, der kun ser efter succesmarkøren, forbliver stille under et nedbrud — stilhed er identisk med "kører stadig".

### Eksempel 2: Forespørge en fjern-API hvert 30. sekund

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` forhindrer en forbigående netværksfejl i at afslutte løkken. Forespørgselsintervaller på 30 sekunder eller mere er passende for fjern-API'er for at undgå hastighedsgrænser. Juster grep-mønsteret for at fange både succes- og fejlsvar, så fejl på API-siden ikke skjules af stilhed.

## Noter

- **Brug altid `grep --line-buffered` i pipes.** Uden det forsinker pipe-bufferlagring hændelser i minutter, fordi operativsystemet akkumulerer output, indtil en 4 KB-blok er fyldt. `--line-buffered` tvinger en flush efter hver linje.
- **Filteret skal dække både succes- og fejlsignaturer.** En monitor, der kun overvåger succesmarkøren, forbliver stille ved nedbrud, hæng eller uventet afslutning. Udvid alternationen: inkluder `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` og lignende terminaltilstandsmarkører ved siden af succesnøgleordet.
- **Forespørgselsintervaller: 30 sekunder eller mere for fjern-API'er.** Hyppig forespørgsel til eksterne tjenester risikerer hastighedsgrænsefejl eller blokeringer. For lokale filsystem- eller proceskontroller er 0,5–1 sekund passende.
- **Brug `persistent: true` til monitorer med sessionens levetid.** Standard `timeout_ms` på 300.000 ms (5 minutter) afslutter processen. For monitorer, der skal køre, indtil de eksplicit stoppes, sæt `persistent: true` og kald `TaskStop` når færdig.
- **Automatisk stop ved hændelsesoversvømmelse.** Hver linje i standardoutput er en samtalebesked. Hvis filteret er for bredt og producerer for mange hændelser, stoppes monitoren automatisk. Genstart med et strammere `grep`-mønster. Linjer, der ankommer inden for 200 ms, grupperes i én notifikation.
