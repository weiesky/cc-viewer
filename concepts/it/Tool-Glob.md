# Glob

## Definizione

Strumento veloce di corrispondenza per pattern di nomi file, supporta codebase di qualsiasi dimensione. Restituisce i percorsi dei file corrispondenti ordinati per data di modifica.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `pattern` | string | Sì | Pattern glob (es. `**/*.js`, `src/**/*.ts`) |
| `path` | string | No | Directory di ricerca, predefinita la directory di lavoro corrente. Non passare "undefined" o "null" |

## Scenari d'uso

**Adatto per:**
- Cercare file per pattern di nome file
- Trovare tutti i file di un tipo specifico (es. tutti i file `.tsx`)
- Localizzare file quando si cerca una definizione di classe specifica (es. `class Foo`)
- È possibile lanciare più chiamate Glob in parallelo in un singolo messaggio

**Non adatto per:**
- Cercare contenuto di file — usare Grep
- Esplorazione aperta che richiede più cicli di ricerca — usare Task (tipo Explore)

## Note

- Supporta la sintassi glob standard: `*` corrisponde a un livello, `**` a più livelli, `{}` per selezione multipla
- I risultati sono ordinati per data di modifica
- Più consigliato rispetto al comando `find` di Bash

## Significato in cc-viewer

Le chiamate Glob appaiono nei log delle richieste come coppie di content block `tool_use` / `tool_result`. Il `tool_result` contiene la lista dei percorsi dei file corrispondenti.

## Testo originale

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
