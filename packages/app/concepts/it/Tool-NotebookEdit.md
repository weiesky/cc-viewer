# NotebookEdit

Modifica una singola cella in un notebook Jupyter (`.ipynb`). Supporta la sostituzione del sorgente di una cella, l'inserimento di una nuova cella o l'eliminazione di una cella esistente preservando il resto della struttura del notebook.

## Quando usare

- Correggere o aggiornare una cella di codice in un notebook di analisi senza riscrivere l'intero file
- Sostituire una cella markdown per migliorare la narrativa o aggiungere documentazione
- Inserire una nuova cella di codice o markdown in una posizione nota in un notebook esistente
- Rimuovere una cella obsoleta o rotta così che le celle a valle non dipendano più da essa
- Preparare un notebook riproducibile iterando sulle celle una alla volta

## Parametri

- `notebook_path` (string, obbligatorio): Percorso assoluto al file `.ipynb`. I percorsi relativi sono rifiutati.
- `new_source` (string, obbligatorio): Il nuovo sorgente della cella. Per `replace` e `insert` diventa il corpo della cella; per `delete` viene ignorato ma comunque richiesto dallo schema.
- `cell_id` (string, opzionale): ID della cella target. Nelle modalità `replace` e `delete`, il tool agisce su questa cella. Nella modalità `insert`, la nuova cella viene inserita immediatamente dopo la cella con questo ID; ometti per inserire in cima al notebook.
- `cell_type` (enum, opzionale): O `code` o `markdown`. Obbligatorio quando `edit_mode` è `insert`. Quando omesso durante `replace`, il tipo della cella esistente viene preservato.
- `edit_mode` (enum, opzionale): `replace` (default), `insert` o `delete`.

## Esempi

### Esempio 1: Sostituire una cella di codice buggata
Chiama `NotebookEdit` con `notebook_path` impostato al percorso assoluto, `cell_id` impostato all'ID della cella target e `new_source` contenente il codice Python corretto. Lascia `edit_mode` al suo default `replace`.

### Esempio 2: Inserire una spiegazione markdown
Per aggiungere una cella markdown subito dopo una cella `setup` esistente, imposta `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` all'ID della cella setup e metti la narrativa in `new_source`.

### Esempio 3: Eliminare una cella obsoleta
Imposta `edit_mode: "delete"` e fornisci il `cell_id` della cella da rimuovere. Fornisci qualsiasi stringa per `new_source`; non viene applicata.

## Note

- Passa sempre un percorso assoluto. `NotebookEdit` non risolve i percorsi relativi rispetto alla working directory.
- Il tool riscrive solo la cella target; i conteggi di esecuzione, gli output e i metadati delle celle non correlate restano intatti.
- Inserire senza un `cell_id` posiziona la nuova cella proprio all'inizio del notebook.
- `cell_type` è obbligatorio per gli inserimenti. Per le sostituzioni, omettilo a meno che tu non voglia esplicitamente convertire una cella di codice in markdown o viceversa.
- Per ispezionare le celle e ottenere i loro ID, usa prima il tool `Read` sul notebook; restituisce le celle con i loro contenuti e output.
- Usa il normale `Edit` per file sorgente semplici; `NotebookEdit` è specifico per il JSON `.ipynb` e comprende la sua struttura di celle.
