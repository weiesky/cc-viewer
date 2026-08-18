# SendFile

Sender én eller flere filer til en annen Claude Code-sesjon — en peer listet av `ListAgents`, eller en eksplisitt sesjonsadresse.

## Når skal den brukes

- En peer-sesjon trenger en fil fra arbeidskatalogen din (en rapport, en patch, en fixture) for å fortsette sin egen oppgave.
- Du koordinerer arbeid på tvers av sesjoner og vil overlevere artefakter, ikke bare tekst (bruk `SendMessage` for tekst).

## Parametere

- `to` (string, påkrevd): Mottaker — et peer-sesjonsnavn fra `ListAgents`, eller en eksplisitt `uds:<socket>` / `bridge:<session id>`-adresse.
- `files` (array av strenger, påkrevd): Filstier (absolutte eller relative til gjeldende arbeidskatalog) som skal sendes. Send alltid en array, selv for én enkelt fil. 1–16 filer, maks 30 MiB hver.
- `message` (string, valgfri): Kort melding levert sammen med filene.

## Eksempler

### Eksempel 1: Send en rapport til en peer-sesjon

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Notater

- Kryss-sesjons filoverføring må være tilgjengelig i sesjonen; når den ikke er det, feiler validering med "Cross-session file transfer is not available in this session."
- Overføringer til eksterne maskiner kan kreve ekstra godkjenning.
- Lesing av filinnholdet er en del av sendingen — avvist hvis fillesing er deaktivert av tillatelsesregler.
