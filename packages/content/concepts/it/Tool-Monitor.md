# Monitor

Avvia un monitor in background che trasmette eventi da uno script a lunga esecuzione. Ogni riga dell'output standard diventa una notifica — continua a lavorare mentre gli eventi arrivano nella chat.

## Quando usare

- Seguire errori, avvisi o firme di crash in un file di log mentre è in corso un deployment
- Interrogare un'API remota, una PR o una pipeline CI ogni 30 secondi per rilevare nuovi eventi di stato
- Sorvegliare le modifiche in una directory del filesystem o nell'output di compilazione in tempo reale
- Attendere una condizione specifica su molte iterazioni (ad esempio un traguardo di un passo di addestramento o lo svuotamento di una coda)
- **Non** per un semplice "aspetta fino al completamento" — usare `Bash` con `run_in_background` per quello; emette una notifica di completamento quando il processo termina

## Attivazione

- Disattivato per default (feature flag lato server).
- Non disponibile su Amazon Bedrock, Google Cloud e Microsoft Foundry.
- Disattivato quando `DISABLE_TELEMETRY` o `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` è impostato.
- La sorgente WebSocket richiede Claude Code 2.1.195+.

## Parametri

- `command` (stringa, obbligatorio): Il comando shell o lo script da eseguire. Ogni riga scritta nello stdout diventa un evento di notifica separato. Il monitor termina quando il processo termina.
- `description` (stringa, obbligatorio): Una breve etichetta leggibile mostrata in ogni notifica. Essere specifici — "errori in deploy.log" è meglio di "osservando i log". Questa etichetta identifica quale monitor si è attivato.
- `timeout_ms` (numero, predefinito `300000`, max `3600000`): Scadenza di terminazione forzata in millisecondi. Dopo questa durata il processo viene terminato. Ignorato quando `persistent: true`.
- `persistent` (booleano, predefinito `false`): Quando `true`, il monitor viene eseguito per tutta la durata della sessione senza timeout. Fermarlo esplicitamente con `TaskStop`.

## Esempi

### Esempio 1: Seguire un file di log per errori e crash

Questo esempio copre tutti gli stati terminali: marcatore di successo, traceback, parole chiave di errore comuni, terminazione OOM e uscita inaspettata del processo.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Usare `grep --line-buffered` in ogni pipe. Senza di esso il sistema operativo memorizza l'output in blocchi da 4 KB e gli eventi possono subire ritardi di minuti. Il motivo di alternanza copre sia il percorso di successo (`deployed`) sia i percorsi di fallimento (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). Un monitor che osserva solo il marcatore di successo rimane silenzioso durante un crash — il silenzio è identico a "ancora in esecuzione".

### Esempio 2: Interrogare un'API remota ogni 30 secondi

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` impedisce che un errore di rete transitorio termini il ciclo. Intervalli di polling di 30 secondi o più sono appropriati per le API remote per evitare i limiti di frequenza. Regolare il motivo grep per catturare sia le risposte di successo che quelle di errore in modo che gli errori lato API non siano mascherati dal silenzio.

## Note

- **Usare sempre `grep --line-buffered` nelle pipe.** Senza di esso, il buffering della pipe ritarda gli eventi di minuti perché il sistema operativo accumula l'output fino a riempire un blocco da 4 KB. `--line-buffered` forza un flush dopo ogni riga.
- **Il filtro deve coprire sia le firme di successo che quelle di fallimento.** Un monitor che osserva solo il marcatore di successo rimane silenzioso in caso di crash, blocco o uscita inaspettata. Ampliare l'alternanza: includere `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` e simili marcatori di stato terminale accanto alla parola chiave di successo.
- **Intervalli di polling: 30 secondi o più per le API remote.** Il polling frequente di servizi esterni rischia errori di limite di frequenza o blocchi. Per le verifiche locali del filesystem o dei processi, 0,5–1 secondo è appropriato.
- **Usare `persistent: true` per i monitor di durata della sessione.** Il `timeout_ms` predefinito di 300.000 ms (5 minuti) termina il processo. Per i monitor che devono essere eseguiti fino all'arresto esplicito, impostare `persistent: true` e chiamare `TaskStop` al termine.
- **Arresto automatico in caso di flood di eventi.** Ogni riga dello stdout è un messaggio di conversazione. Se il filtro è troppo ampio e produce troppi eventi, il monitor viene fermato automaticamente. Riavviarlo con un motivo `grep` più stretto. Le righe che arrivano entro 200 ms vengono raggruppate in una singola notifica.
