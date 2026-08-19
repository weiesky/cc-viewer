# CronDelete

Annulla un job cron precedentemente pianificato con `CronCreate`. Lo rimuove immediatamente dall'archivio di sessione in memoria. Non ha effetto se il job è già stato eliminato automaticamente (i job a esecuzione singola vengono rimossi dopo l'attivazione, i job ricorrenti scadono dopo 7 giorni).

## Quando usare

- Un utente chiede di interrompere un'attività pianificata ricorrente prima della scadenza automatica di 7 giorni.
- Un job a esecuzione singola non è più necessario e deve essere annullato prima che si attivi.
- È necessario modificare l'espressione di pianificazione di un job esistente — eliminarlo con `CronDelete`, quindi ricrearlo con `CronCreate` usando la nuova espressione.
- Pulire più job obsoleti per mantenere l'archivio di sessione ordinato.

## Parametri

- `id` (string, obbligatorio): L'ID del job restituito da `CronCreate` al momento della creazione iniziale del job. Questo valore deve corrispondere esattamente; la ricerca approssimativa o per nome non è supportata.

## Esempi

### Esempio 1: annullare un job ricorrente in esecuzione

Un job ricorrente è stato creato in precedenza con l'ID `"cron_abc123"`. L'utente chiede di interromperlo.

```
CronDelete({ id: "cron_abc123" })
```

Il job viene rimosso dall'archivio di sessione e non si attiverà più.

### Esempio 2: rimuovere un job a esecuzione singola obsoleto prima dell'attivazione

Un job a esecuzione singola con l'ID `"cron_xyz789"` è stato pianificato per essere eseguito tra 30 minuti, ma l'utente ha deciso che non è più necessario.

```
CronDelete({ id: "cron_xyz789" })
```

Il job viene annullato. Nessuna azione verrà eseguita quando arriverà il momento di attivazione originale.

## Note

- L'`id` deve essere ottenuto dal valore di ritorno di `CronCreate`. Non esiste un modo per cercare un job per descrizione o callback — conservare l'ID se potrebbe essere necessario annullarlo in seguito.
- Se il job è già stato eliminato automaticamente (attivato come job a esecuzione singola, o raggiunta la scadenza ricorrente di 7 giorni), chiamare `CronDelete` con quell'ID è un'operazione senza effetto e non produrrà un errore.
- `CronDelete` influisce solo sulla sessione in memoria corrente. Se l'ambiente di runtime non persiste lo stato cron tra i riavvii, i job pianificati andranno persi al riavvio indipendentemente dal fatto che `CronDelete` sia stato chiamato.
- Non esiste un'operazione di eliminazione in blocco; annullare ogni job singolarmente usando il proprio `id`.
