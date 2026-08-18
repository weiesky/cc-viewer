# REPL

Esegue JavaScript in un contesto vm Node.js persistente all'interno della sessione. L'`await` di primo livello è supportato, e le variabili/funzioni definite in una chiamata restano disponibili nelle chiamate successive.

## Quando usare

- Calcoli rapidi, trasformazione di dati o manipolazione di JSON che risultano più semplici in codice che in one-liner di shell.
- Scripting multi-passo in cui lo stato intermedio deve persistere tra le chiamate (contatori, risultati accumulati).
- Sondare interattivamente il comportamento di un'API o di una libreria prima di scriverlo in un file.

## Parametri

- `code` (string, obbligatorio): Codice JavaScript da eseguire. Supporta l'await di primo livello. Lo stato persiste tra le chiamate.
- `description` (string, opzionale): Descrizione chiara e concisa di cosa fa questo script in forma attiva (5–10 parole), ad esempio "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, opzionale): Timeout in millisecondi. Default: 30000; massimo 600000.

## Esempi

### Esempio 1: Calcolare e riusare lo stato

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Restituisce `2`; `counts` resta definito per le chiamate REPL successive nella stessa sessione.

### Esempio 2: Await di primo livello con un timeout più lungo

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Note

- Lo stato è per-sessione: riavviare la sessione azzera tutte le definizioni.
- Questo è un ambiente JavaScript (Node) — usa Bash per comandi shell, lavoro intensivo sul filesystem o runtime non-JS.
- Il codice a lunga esecuzione dovrebbe impostare un `timeout` esplicito; il default di 30s termina qualsiasi cosa più lenta.
