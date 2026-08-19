# SendFeedback

Invia feedback strutturato su Claude Code ad Anthropic — segnalazioni di bug, idee di funzionalità o capacità mancanti — senza lasciare la sessione.

## Quando usare

- L'utente chiede di segnalare un bug o inviare feedback su Claude Code stesso.
- Incontri un chiaro difetto di prodotto (comando rotto, comportamento errato, crash) che merita di essere segnalato.
- L'utente descrive una funzionalità che vorrebbe esistesse (un'idea o una capacità mancante).

## Parametri

- `type` (string, obbligatorio): Uno tra `bug`, `idea`, `missing_capability`.
- `title` (string, obbligatorio): Riepilogo breve e specifico di una riga del problema.
- `details` (string, obbligatorio): Elenco puntato etichettato, in ordine: **What happened:** (osservato vs. atteso, testo esatto dell'errore se breve); **What the user said:** (citato, oppure "User didn't comment; observed by the model."); **Repro:** (passi minimi); **Evidence:** (ID di richiesta, timestamp, percorsi, versioni — ometti se non ce ne sono); facoltativamente un **Cause:** finale solo se verificato in sessione. Da una a tre righe per punto; niente paragrafi narrativi, niente speculazioni, niente segreti.
- `area` (string, opzionale): Tag breve che nomina la parte di Claude Code a cui si riferisce il feedback (ad esempio "hooks config", "/help", "file editing"). Lascia vuoto se non è chiaro.
- `failure_mode` (string, opzionale): Per segnalazioni sul comportamento del modello, la modalità di fallimento più vicina (ad esempio `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short`, oppure `other`). Ometti solo quando la segnalazione è un puro bug di prodotto/tool.
- `task_category` (string, opzionale): Cosa stava facendo la sessione quando si è verificato il problema: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review`, oppure `other`.

## Esempi

### Esempio 1: Segnalare un bug di prodotto

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Note

- Non includere mai segreti, token o dati privati dell'utente in `details`.
- Cita le parole dell'utente quando disponibili; altrimenti dichiara che il modello ha osservato il problema.
- Mantieni la segnalazione fattuale — la speculazione sulla causa radice appartiene a `**Cause:**` solo quando è verificata in sessione.
