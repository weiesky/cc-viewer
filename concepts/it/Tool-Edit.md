# Edit

## Definizione

Modifica file tramite sostituzione esatta di stringhe. Sostituisce `old_string` con `new_string` nel file.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `file_path` | string | Sì | Percorso assoluto del file da modificare |
| `old_string` | string | Sì | Testo originale da sostituire |
| `new_string` | string | Sì | Nuovo testo sostitutivo (deve essere diverso da old_string) |
| `replace_all` | boolean | No | Se sostituire tutte le occorrenze, predefinito `false` |

## Scenari d'uso

**Adatto per:**
- Modificare sezioni specifiche di codice in file esistenti
- Correggere bug, aggiornare la logica
- Rinominare variabili (con `replace_all: true`)
- Qualsiasi scenario che richieda la modifica precisa del contenuto di un file

**Non adatto per:**
- Creare nuovi file — usare Write
- Riscritture su larga scala — potrebbe essere necessario Write per sovrascrivere l'intero file

## Note

- Prima dell'uso è necessario aver letto il file tramite Read, altrimenti si verifica un errore
- `old_string` deve essere unico nel file, altrimenti la modifica fallisce. Se non è unico, fornire più contesto per renderlo unico, oppure usare `replace_all`
- Quando si modifica il testo, mantenere l'indentazione originale (tab/spazi), non includere il prefisso del numero di riga dall'output di Read
- Preferire la modifica dei file esistenti anziché crearne di nuovi
- `new_string` deve essere diverso da `old_string`

## Significato in cc-viewer

Le chiamate Edit appaiono nei log delle richieste come content block `tool_use`, il cui `input` contiene `old_string` e `new_string`, utili per tracciare quali modifiche il modello ha apportato ai file.

## Testo originale

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
