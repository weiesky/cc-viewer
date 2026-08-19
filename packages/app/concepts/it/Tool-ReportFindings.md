# ReportFindings

Segnala i risultati della revisione del codice come un elenco tipato e strutturato che l'UI host renderizza nativamente — invece di stamparli come testo di chat.

## Quando usare

- Concludere una revisione del codice le cui istruzioni attive dicono esplicitamente di segnalare i risultati con questo strumento
- Ri-segnalare dopo l'applicazione di correzioni, quando le istruzioni di revisione lo richiedono (ogni risultato quindi porta un `outcome`)
- **Non** per opinioni ad hoc, risposte ordinarie o revisioni le cui istruzioni specificano un formato di output diverso — e mai insieme a una copia di testo duplicata degli stessi risultati

## Parametri

- `findings` (array, obbligatorio, max 32): I risultati verificati, classificati per severità prima — un array vuoto se nessun risultato ha superato la verifica. Ogni risultato:
  - `file` (stringa, obbligatorio): Percorso relativo al repository.
  - `line` (numero, facoltativo): Numero di linea di ancoraggio indicizzato da 1.
  - `summary` (stringa, obbligatorio): Affermazione del difetto in una singola frase.
  - `failure_scenario` (stringa, obbligatorio): Input/stato concreto → output errato o crash.
  - `category` (stringa, facoltativo): Slug breve in kebab-case, es. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (stringa, facoltativo): `CONFIRMED` o `PLAUSIBLE` — impostato quando una verifica è stata eseguita; assente su revisioni solo inline.
  - `outcome` (stringa, facoltativo): SOLO quando ri-segnali dopo correzioni — `fixed`, `skipped` o `no_change_needed`.
- `level` (stringa, facoltativo): Il livello di sforzo al quale la revisione è stata eseguita — `low`, `medium`, `high`, `xhigh` o `max`.

## Note

- **Chiamala una volta.** Una singola chiamata con l'elenco completo, verificato e ordinato per severità — non una chiamata per risultato.
- **Vuoto è un risultato valido.** Se nessun risultato ha superato la verifica, segnala un array vuoto piuttosto che riempire con risultati deboli.
- **Non duplicare nel testo.** Quando questo strumento segnala i risultati, i risultati non devono essere stampati anche come un messaggio di chat.
- **`outcome` è solo per ri-segnalazioni.** Nel primo rapporto lascialo non impostato; dopo una passata di applicazione, imposta cosa è realmente accaduto a ogni risultato.
