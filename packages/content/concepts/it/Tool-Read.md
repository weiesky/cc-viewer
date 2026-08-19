# Read

Carica il contenuto di un singolo file dal filesystem locale. Supporta testo semplice, codice sorgente, immagini, PDF e notebook Jupyter, restituendo i risultati con numeri di riga a base 1 in stile `cat -n`.

## Quando usare

- Leggere un file sorgente a un percorso noto prima di modificarlo o analizzarlo
- Ispezionare file di configurazione, lockfile, log o artefatti generati
- Visualizzare screenshot o diagrammi che l'utente ha incollato nella conversazione
- Estrarre un intervallo di pagine specifico da un lungo manuale PDF
- Aprire un notebook `.ipynb` per rivedere celle di codice, markdown e output delle celle insieme

## Parametri

- `file_path` (string, obbligatorio): Percorso assoluto al file target. I percorsi relativi sono rifiutati.
- `offset` (integer, opzionale): Numero di riga a base 1 da cui iniziare la lettura. Utile per file grandi quando abbinato a `limit`.
- `limit` (integer, opzionale): Numero massimo di righe da restituire a partire da `offset`. Default: 2000 righe dall'inizio del file quando omesso.
- `pages` (string, opzionale): Intervallo di pagine per file PDF, ad esempio `"1-5"`, `"3"` o `"10-20"`. Obbligatorio per PDF più lunghi di 10 pagine; massimo 20 pagine per richiesta.

## Esempi

### Esempio 1: Leggere un piccolo file per intero
Chiama `Read` con solo `file_path` impostato a `/Users/me/project/src/index.ts`. Vengono restituite fino a 2000 righe con numeri di riga, il che è di solito sufficiente per il contesto di editing.

### Esempio 2: Paginare attraverso un lungo log
Usa `offset: 5001` e `limit: 500` su un file di log di molte migliaia di righe per recuperare una finestra stretta senza sprecare token di contesto.

### Esempio 3: Estrarre pagine PDF specifiche
Per un PDF di 120 pagine in `/tmp/spec.pdf`, imposta `pages: "8-15"` per tirare fuori solo il capitolo di cui hai bisogno. Omettere `pages` su un PDF grande produce un errore.

### Esempio 4: Visualizzare un'immagine
Passa il percorso assoluto di uno screenshot PNG o JPG. L'immagine viene resa visivamente così che Claude Code possa ragionarci sopra direttamente.

## Note

- Preferisci sempre percorsi assoluti. Se l'utente ne fornisce uno, fidatene così com'è.
- Righe più lunghe di 2000 caratteri vengono troncate; tratta il contenuto restituito come possibilmente tagliato per dati estremamente larghi.
- Leggi più file indipendenti? Emetti più chiamate `Read` nella stessa risposta così che vengano eseguite in parallelo.
- `Read` non può elencare directory. Usa una chiamata `Bash` con `ls` o il tool `Glob` invece.
- Leggere un file esistente ma vuoto restituisce un avviso di sistema piuttosto che i byte del file, quindi gestisci quel segnale esplicitamente.
- Un `Read` riuscito è richiesto prima di poter usare `Edit` sullo stesso file nella sessione corrente.
