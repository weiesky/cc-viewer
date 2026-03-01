# executeCode (mcp__ide__executeCode)

## Definizione

Esegue codice Python nel kernel Jupyter del file notebook corrente.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `code` | string | Sì | Codice Python da eseguire |

## Scenari d'uso

**Adatto per:**
- Eseguire codice in un ambiente Jupyter notebook
- Testare frammenti di codice
- Analisi dati e calcoli

**Non adatto per:**
- Esecuzione di codice in ambienti non Jupyter — usare Bash
- Modificare file — usare Edit o Write

## Note

- Questo è uno strumento MCP (Model Context Protocol), fornito dall'integrazione IDE
- Il codice viene eseguito nel kernel Jupyter corrente, lo stato persiste tra le chiamate
- A meno che l'utente non lo richieda esplicitamente, evitare di dichiarare variabili o modificare lo stato del kernel
- Lo stato viene perso dopo il riavvio del kernel

## Significato in cc-viewer

executeCode è uno strumento MCP, che appare nell'array `tools` dei log delle richieste con il nome `mcp__ide__executeCode`. Le sue chiamate e i risultati seguono il pattern standard `tool_use` / `tool_result`. L'aggiunta/rimozione di strumenti MCP causa modifiche all'array tools, che possono attivare la ricostruzione della cache.

## Testo originale

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
