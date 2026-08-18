# LSP

Interroga i server del Language Server Protocol (LSP) per ottenere intelligenza sul codice — definizioni, riferimenti, hover, simboli, implementazioni e gerarchia delle chiamate. Più preciso della ricerca testuale perché comprende il codice in modo semantico.

## Quando usare

- Saltare alla definizione di un simbolo (`goToDefinition`) o trovare ogni riferimento (`findReferences`)
- Leggere le firme di tipo / la documentazione di un simbolo (`hover`)
- Elencare i simboli in un file (`documentSymbol`) o cercarli in tutto il progetto (`workspaceSymbol`)
- Trovare le implementazioni di un'interfaccia o di un metodo astratto (`goToImplementation`)
- Percorrere la gerarchia delle chiamate di una funzione (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Attivazione

- Inattivo finché non viene installato un plugin di code intelligence per il linguaggio (il binario del server è installato separatamente).
- Lo strumento compare solo quando un client LSP è connesso.

## Parametri

- `operation` (string, obbligatorio): una delle operazioni elencate sopra.
- `filePath` (string, obbligatorio): il file su cui operare.
- `line` (number, obbligatorio): numero di riga a base 1, come mostrato nell'editor.
- `character` (number, obbligatorio): offset di carattere a base 1, come mostrato nell'editor.

## Note

- Richiede un server LSP configurato per quel tipo di file; altrimenti la chiamata restituisce un errore.
- Riga e carattere sono a base 1 (coordinate dell'editor), non a base 0.
- Preferisci LSP a `Grep` quando hai bisogno di navigazione semantica (definizione/riferimento reali) anziché di una corrispondenza testuale.

## Concetti correlati

- Complementa `Read` ed `Edit` quando navighi e modifichi il codice.
