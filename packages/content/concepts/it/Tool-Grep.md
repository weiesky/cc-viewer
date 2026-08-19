# Grep

Cerca i contenuti dei file usando il motore ripgrep. Offre supporto completo per espressioni regolari, filtraggio per tipo di file e tre modalità di output così da poter scambiare precisione per compattezza.

## Quando usare

- Localizzare ogni call site di una funzione o ogni riferimento a un identificatore
- Verificare se una stringa o un messaggio di errore appare ovunque nel codebase
- Contare le occorrenze di un pattern per misurare l'impatto prima di un refactor
- Restringere una ricerca a un tipo di file (`type: "ts"`) o glob (`glob: "**/*.tsx"`)
- Estrarre corrispondenze multi-riga come definizioni di struct multi-riga o blocchi JSX con `multiline: true`

## Parametri

- `pattern` (string, obbligatorio): L'espressione regolare da cercare. Usa la sintassi ripgrep, quindi le parentesi graffe letterali devono essere escapate (ad esempio `interface\{\}` per trovare `interface{}`).
- `path` (string, opzionale): File o directory da cercare. Default: working directory corrente.
- `glob` (string, opzionale): Filtro di nome file come `*.js` o `*.{ts,tsx}`.
- `type` (string, opzionale): Scorciatoia per tipo di file come `js`, `py`, `rust`, `go`. Più efficiente di `glob` per linguaggi standard.
- `output_mode` (enum, opzionale): `files_with_matches` (default, restituisce solo i percorsi), `content` (restituisce le righe corrispondenti) o `count` (restituisce i conteggi delle corrispondenze).
- `-i` (boolean, opzionale): Abbinamento case-insensitive.
- `-n` (boolean, opzionale): Include i numeri di riga in modalità `content`. Default `true`.
- `-A` (number, opzionale): Righe di contesto da mostrare dopo ogni corrispondenza (richiede modalità `content`).
- `-B` (number, opzionale): Righe di contesto prima di ogni corrispondenza (richiede modalità `content`).
- `-C` / `context` (number, opzionale): Righe di contesto su entrambi i lati di ogni corrispondenza.
- `multiline` (boolean, opzionale): Permette ai pattern di estendersi su più righe (`.` corrisponde a `\n`). Default `false`.
- `head_limit` (number, opzionale): Limita le righe restituite, i percorsi dei file o le voci di conteggio. Default 250; passa `0` per illimitato (usa con parsimonia).
- `offset` (number, opzionale): Salta i primi N risultati prima di applicare `head_limit`. Default `0`.

## Esempi

### Esempio 1: Trovare tutti i call site di una funzione
Imposta `pattern: "registerHandler\\("`, `output_mode: "content"` e `-C: 2` per vedere le righe circostanti di ogni chiamata.

### Esempio 2: Contare le corrispondenze su un tipo
Imposta `pattern: "TODO"`, `type: "py"` e `output_mode: "count"` per vedere i totali per file di TODO nei sorgenti Python.

### Esempio 3: Corrispondenza di struct multi-riga
Usa `pattern: "struct Config \\{[\\s\\S]*?version"` con `multiline: true` per catturare un campo dichiarato diverse righe dentro una struct Go.

## Note

- Preferisci sempre `Grep` all'esecuzione di `grep` o `rg` tramite `Bash`; il tool è ottimizzato per permessi corretti e output strutturato.
- La modalità di output predefinita è `files_with_matches`, che è la più economica. Passa a `content` solo quando devi vedere le righe stesse.
- I flag di contesto (`-A`, `-B`, `-C`) sono ignorati a meno che `output_mode` non sia `content`.
- Insiemi di risultati grandi bruciano token di contesto. Usa `head_limit`, `offset` o filtri `glob`/`type` più stretti per restare focalizzati.
- Per la scoperta di nomi di file, usa invece `Glob`; per indagini aperte su molti cicli, invia un `Agent` con l'agente Explore.
