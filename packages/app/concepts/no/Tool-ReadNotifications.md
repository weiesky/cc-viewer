# ReadNotifications

Leser varsler som står i kø for assistenten i gjeldende sesjon — GitHub-aktivitet på abonnerte PR-er (`github_webhook`), avfyringer av planlagte triggere (`trigger_fire`) og meldinger som ankommer fra andre Claude-sesjoner (`mcp_send_message`).

## Når skal den brukes

- Du ble varslet om at noe skjedde — en abonnert PR ble oppdatert, en planlagt trigger ble avfyrt, en annen sesjon sendte deg en melding — og trenger selve nyttelasten.
- Tømme en etterslep: store bunter returneres i deler, så fortsett å kalle til resultatet rapporterer 0 `remaining`.

## Parametere

Dette verktøyet tar ingen parametere.

## Eksempler

### Eksempel 1: Tøm ventende varsler

```
ReadNotifications()
```

Returnerer ventende varsler eldst først. Resultatet inkluderer en `remaining`-telling av varsler som fortsatt står i kø etter denne tømmingen — kall verktøyet igjen for å lese dem.

## Notater

- Tømminger har et størrelsesbudsjett: et oppfølgingskall returnerer resten av den SAMME køen (pluss alt som nylig har ankommet), ikke bare nye ankomster. Gjenta til `remaining` er 0.
- Varsler stammer fra GitHub-webhooks på abonnerte PR-er, planlagte triggere og meldinger fra andre Claude-sesjoner; det finnes ingen filtreringsparameter i gjeldende versjon.
