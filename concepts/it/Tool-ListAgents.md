# ListAgents

Elenca gli agent a cui puoi inviare `SendMessage`: subagenti in-process che hai lanciato, altre sessioni Claude locali su questa macchina, le tue sessioni cloud (quando questa sessione ha accesso cloud) e — quando il Controllo Remoto è connesso — le altre sessioni del tuo account. Ogni riga è etichettata per tipo.

## Quando usare

- Hai bisogno del nome esatto di una sessione peer o di un subagente prima di inviargli un messaggio.
- Vuoi vedere quali sessioni sono attualmente raggiungibili da questa.

## Attivazione

- Richiede Claude Code 2.1.224+ e la messaggistica tra sessioni (un feature flag lato server, disattivato per default).
- La messaggistica tra sessioni non è disponibile su Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform e Microsoft Foundry.
- Disattivato quando `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK` o `DISABLE_GROWTHBOOK` è impostato.
- Forza l'abilitazione con `CLAUDE_CODE_HARBOR_KITE=1`.

## Parametri

- `channel` (string, opzionale): Non disponibile in questa build; lascia non impostato.
- `q` (string, opzionale): Non disponibile in questa build; lascia non impostato.

## Esempi

### Esempio 1: Elencare gli agent raggiungibili

```
ListAgents()
```

Ogni riga stampa un nome — quel nome è l'indirizzo. Invia con `SendMessage({to: "<name>", message: "..."})`, copiando il nome esattamente come stampato. Aggiungi il ` [ref]` di una riga solo quando il nome semplice è ambiguo (due righe lo condividono, o un errore ti chiede di disambiguare).

## Note

- In sola lettura e sicuro per la concorrenza.
- Una sessione cloud riceve il tuo messaggio ma non può ancora rispondere — leggi la sua risposta nel suo transcript.
