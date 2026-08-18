# ListAgents

Elenca gli agent a cui puoi inviare `SendMessage`: subagenti in-process che hai lanciato, altre sessioni Claude locali su questa macchina, le tue sessioni cloud (quando questa sessione ha accesso cloud) e — quando il Controllo Remoto è connesso — le altre sessioni del tuo account. Ogni riga è etichettata per tipo.

## Quando usare

- Hai bisogno del nome esatto di una sessione peer o di un subagente prima di inviargli un messaggio.
- Vuoi vedere quali sessioni sono attualmente raggiungibili da questa.

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
- La disponibilità dipende dalla configurazione della sessione (la messaggistica tra sessioni è una funzionalità gated).
