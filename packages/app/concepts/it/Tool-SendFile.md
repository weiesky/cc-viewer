# SendFile

Invia uno o più file a un'altra sessione di Claude Code — un peer elencato da `ListAgents`, oppure un indirizzo di sessione esplicito.

## Quando usare

- Una sessione peer ha bisogno di un file dalla tua directory di lavoro (un report, una patch, un fixture) per continuare il suo compito.
- Stai coordinando lavoro tra sessioni e vuoi passare artefatti, non solo testo (usa `SendMessage` per il testo).

## Attivazione

- Il trasferimento di file tra sessioni deve essere disponibile nella sessione; quando non lo è, la validazione fallisce con "Cross-session file transfer is not available in this session."
- Gated dalle stesse condizioni di messaggistica tra sessioni di `ListAgents` (feature flag lato server, disattivati per default).

## Parametri

- `to` (string, obbligatorio): Destinatario — un nome di sessione peer da `ListAgents`, oppure un indirizzo esplicito `uds:<socket>` / `bridge:<session id>`.
- `files` (array of strings, obbligatorio): Percorsi di file (assoluti o relativi alla cwd) da inviare. Passa sempre un array, anche per un singolo file. 1–16 file, al massimo 30 MiB ciascuno.
- `message` (string, opzionale): Breve messaggio consegnato insieme ai file.

## Esempi

### Esempio 1: Inviare un report a una sessione peer

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Note

- I trasferimenti verso macchine remote possono richiedere un'approvazione aggiuntiva.
- Leggere il contenuto del file fa parte dell'invio — negato se la lettura dei file è disabilitata dalle regole di permesso.
