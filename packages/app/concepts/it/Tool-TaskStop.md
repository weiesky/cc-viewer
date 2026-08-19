# TaskStop

Ferma un task in background in esecuzione — un comando shell, un agente inviato o una sessione remota — tramite il suo handle di runtime. Usalo per liberare risorse, annullare lavoro che non è più utile o recuperare quando un task è bloccato.

## Quando usare

- Un comando shell in background è in esecuzione più a lungo del previsto e non ti serve più il suo risultato.
- Un agente locale è in loop o in stallo e deve essere interrotto.
- L'utente ha cambiato direzione e il lavoro in background per la direzione precedente dovrebbe essere abbandonato.
- Una sessione remota sta per andare in timeout o sta trattenendo una risorsa di cui hai bisogno.
- Hai bisogno di una lavagna pulita prima di avviare una nuova esecuzione dello stesso task.

Preferisci lasciare che il lavoro in background di breve durata finisca da solo. `TaskStop` è per casi in cui l'esecuzione continuata non ha valore o è attivamente dannosa.

## Parametri

- `task_id` (string, obbligatorio): L'handle di runtime restituito quando il task in background è stato avviato. È lo stesso identificatore accettato da `TaskOutput`, non un `taskId` della task-list.

## Esempi

### Esempio 1

Ferma un comando shell in background che è fuori controllo.

```
TaskStop(task_id: "bash_01HXYZ...")
```

Il comando riceve un segnale di terminazione; l'output bufferizzato scritto finora resta leggibile al suo percorso di output.

### Esempio 2

Annulla un agente inviato dopo una correzione di rotta dell'utente.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Note

- `TaskStop` richiede la terminazione; non garantisce spegnimento istantaneo. I task ben comportati escono prontamente, ma un processo che fa I/O bloccante potrebbe impiegare un momento per disattivarsi.
- Fermare un task non elimina il suo output. Per task shell in background, il file di output su disco è preservato e ancora leggibile con `Read`. Per agenti e sessioni, qualunque output sia stato catturato prima dello stop è ancora accessibile via `TaskOutput`.
- Un `task_id` sconosciuto, o un task già terminato, restituisce un errore o un no-op. È sicuro — puoi chiamare `TaskStop` difensivamente senza controllare prima lo stato.
- Se intendi riavviare lo stesso lavoro, ferma il vecchio task prima di inviare quello nuovo per evitare che due esecuzioni parallele competano su risorse condivise (file, porte, righe di database).
- `TaskStop` non influisce sulle voci nella lista dei task del team. Per annullare un task tracciato, aggiorna il suo stato a `deleted` con `TaskUpdate`.
