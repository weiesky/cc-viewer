# Monitor

Starter en bakgrunnsmonitor som strømmer hendelser fra et langvarig skript. Hver linje i standardutdata blir en varsling — fortsett å arbeide mens hendelser ankommer i chatten.

## Når skal den brukes

- Følge med på feil, advarsler eller krasj-signaturer i en loggfil mens et utrullingsoppdrag kjører
- Spørre et eksternt API, en PR eller en CI-pipeline hvert 30. sekund for å oppdage nye statushendelser
- Overvåke endringer i en filsystemmapp eller byggutdata i sanntid
- Vente på en bestemt betingelse over mange iterasjoner (f.eks. en milepæl i et treningssteg eller tømming av en kø)
- **Ikke** for enkelt "vent til ferdig" — bruk `Bash` med `run_in_background` for det; det sender én fullføringsvarsling når prosessen avsluttes

## Aktivering

- Av som standard (server-side feature-flag).
- Utilgjengelig på Amazon Bedrock, Google Cloud og Microsoft Foundry.
- Av når `DISABLE_TELEMETRY` eller `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` er satt.
- WebSocket-kilden krever Claude Code 2.1.195+.

## Parametere

- `command` (streng, påkrevd): Shell-kommandoen eller skriptet som skal kjøres. Hver linje skrevet til standardutdata blir en separat varslershendelse. Monitoren avsluttes når prosessen avsluttes.
- `description` (streng, påkrevd): En kort, lesbar etikett som vises i hver varsling. Vær spesifikk — "feil i deploy.log" er bedre enn "ser på logger". Denne etiketten identifiserer hvilken monitor som ble utløst.
- `timeout_ms` (tall, standard `300000`, maks `3600000`): Tvangsavslutningsfrist i millisekunder. Etter denne varigheten avsluttes prosessen. Ignoreres når `persistent: true`.
- `persistent` (boolsk, standard `false`): Når `true`, kjører monitoren i hele sesjonens levetid uten tidsavbrudd. Stopp den eksplisitt med `TaskStop`.

## Eksempler

### Eksempel 1: Følge en loggfil for feil og krasj

Dette eksemplet dekker alle terminaltilstander: suksessmarkør, traceback, vanlige feilnøkkelord, OOM-avslutning og uventet prosessavslutning.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Bruk `grep --line-buffered` i alle rør. Uten det bufrer operativsystemet utdata i 4 KB-blokker, og hendelser kan forsinkes i minutter. Vekselmønsteret dekker både suksessveien (`deployed`) og feilveiene (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). En monitor som bare ser etter suksessmarkøren, forblir stille ved et krasj — stillhet ser identisk ut som "kjører fortsatt".

### Eksempel 2: Spørre et eksternt API hvert 30. sekund

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` forhindrer en forbigående nettverksfeil fra å avslutte løkken. Spørringsintervaller på 30 sekunder eller mer er hensiktsmessige for eksterne APIer for å unngå hastighetsbegrensninger. Juster grep-mønsteret for å fange både suksess- og feilsvar slik at feil på API-siden ikke skjules av stillhet.

## Notater

- **Bruk alltid `grep --line-buffered` i rør.** Uten det forsinker rør-bufring hendelser i minutter fordi operativsystemet akkumulerer utdata til en 4 KB-blokk er fylt. `--line-buffered` tvinger en tømming etter hver linje.
- **Filteret må dekke både suksess- og feilsignaturer.** En monitor som bare overvåker suksessmarkøren, forblir stille ved krasj, henging eller uventet avslutning. Utvid vekslingen: inkluder `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` og lignende terminaltilstandsmarkører ved siden av suksessnøkkelordet.
- **Spørringsintervaller: 30 sekunder eller mer for eksterne APIer.** Hyppig spørring av eksterne tjenester risikerer hastighetsbegrensningsfeil eller blokkering. For lokale filsystem- eller prosesskontroller er 0,5–1 sekund hensiktsmessig.
- **Bruk `persistent: true` for monitorer med sesjonens levetid.** Standard `timeout_ms` på 300 000 ms (5 minutter) avslutter prosessen. For monitorer som skal kjøre til de eksplisitt stoppes, sett `persistent: true` og kall `TaskStop` når ferdig.
- **Automatisk stopp ved hendelsesflomsituasjon.** Hver linje i standardutdata er en samtalemelding. Hvis filteret er for bredt og produserer for mange hendelser, stoppes monitoren automatisk. Start på nytt med et strammere `grep`-mønster. Linjer som ankommer innen 200 ms grupperes til én varsling.
