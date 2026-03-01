# getDiagnostics (mcp__ide__getDiagnostics)

## Definizione

Ottiene informazioni diagnostiche del linguaggio da VS Code, inclusi errori di sintassi, errori di tipo, avvisi lint, ecc.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `uri` | string | No | URI del file. Se non fornito, ottiene le informazioni diagnostiche di tutti i file |

## Scenari d'uso

**Adatto per:**
- Controllare problemi semantici del codice come sintassi, tipi, lint
- Verificare se sono stati introdotti nuovi errori dopo la modifica del codice
- Sostituire i comandi Bash per controllare la qualità del codice

**Non adatto per:**
- Eseguire test — usare Bash
- Controllare errori a runtime — usare Bash per eseguire il codice

## Note

- Questo è uno strumento MCP (Model Context Protocol), fornito dall'integrazione IDE
- Disponibile solo in ambienti VS Code / IDE
- Preferire questo strumento rispetto ai comandi Bash per controllare i problemi del codice

## Significato in cc-viewer

getDiagnostics è uno strumento MCP, che appare nell'array `tools` dei log delle richieste con il nome `mcp__ide__getDiagnostics`. Le sue chiamate e i risultati seguono il pattern standard `tool_use` / `tool_result`. L'aggiunta/rimozione di strumenti MCP causa modifiche all'array tools, che possono attivare la ricostruzione della cache.

## Testo originale

<textarea readonly>Get language diagnostics from VS Code</textarea>
