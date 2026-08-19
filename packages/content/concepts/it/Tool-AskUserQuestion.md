# AskUserQuestion

Presenta all'utente una o più domande strutturate a scelta multipla all'interno dell'UI di chat, raccoglie le sue selezioni e le restituisce all'assistente — utile per disambiguare l'intento senza un continuo scambio a testo libero.

## Quando usare

- Una richiesta ha più interpretazioni ragionevoli e l'assistente ha bisogno che l'utente ne scelga una prima di procedere.
- L'utente deve scegliere tra opzioni concrete (framework, libreria, percorso file, strategia) dove le risposte a testo libero sarebbero soggette a errori.
- Vuoi confrontare alternative fianco a fianco usando il pannello di anteprima.
- Diverse decisioni correlate possono essere raggruppate in un unico prompt per ridurre gli scambi.
- Un piano o una chiamata tool dipende da una configurazione che l'utente non ha ancora specificato.

## Parametri

- `questions` (array, obbligatorio): Da una a quattro domande mostrate insieme in un unico prompt. Ogni oggetto domanda contiene:
  - `question` (string, obbligatorio): Il testo completo della domanda, che termina con un punto interrogativo.
  - `header` (string, obbligatorio): Un'etichetta breve (al massimo 12 caratteri) resa come chip sopra la domanda.
  - `options` (array, obbligatorio): Da due a quattro oggetti opzione. Ogni opzione ha un `label` (1–5 parole), una `description` e un'anteprima opzionale `markdown`.
  - `multiSelect` (boolean, obbligatorio): Quando `true`, l'utente può selezionare più di un'opzione.

## Esempi

### Esempio 1: Scegliere un singolo framework

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Esempio 2: Anteprima fianco a fianco di due layout

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Note

- L'UI aggiunge automaticamente un'opzione "Other" a testo libero a ogni domanda. Non aggiungere le tue voci "Other", "None" o "Custom" — duplicheranno l'uscita di sicurezza integrata.
- Limita ogni chiamata tra una e quattro domande e ogni domanda tra due e quattro opzioni. Superare questi limiti viene rifiutato dall'harness.
- Se raccomandi un'opzione specifica, mettila per prima e aggiungi "(Recommended)" alla sua label così che l'UI evidenzi il percorso preferito.
- Le anteprime tramite il campo `markdown` sono supportate solo su domande a singola selezione. Usale per artefatti visivi come layout ASCII, snippet di codice o diff di configurazione — non per semplici domande di preferenza dove una label più una descrizione sono sufficienti.
- Quando un'opzione in una domanda ha un valore `markdown`, l'UI passa a un layout fianco a fianco con la lista delle opzioni a sinistra e l'anteprima a destra.
- Non usare `AskUserQuestion` per chiedere "questo piano va bene?" — chiama invece `ExitPlanMode`, che esiste proprio per l'approvazione del piano. In plan mode, evita anche di menzionare "il piano" nel testo della domanda, perché il piano non è visibile all'utente fino a quando `ExitPlanMode` non viene eseguito.
- Non usare questo tool per richiedere input sensibili o a testo libero come chiavi API o password. Chiedi invece in chat.
