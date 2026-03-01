# Write

## Definizione

Scrive contenuto nel file system locale. Se il file esiste già, viene sovrascritto.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `file_path` | string | Sì | Percorso assoluto del file (deve essere assoluto) |
| `content` | string | Sì | Contenuto da scrivere |

## Scenari d'uso

**Adatto per:**
- Creare nuovi file
- Quando è necessario riscrivere completamente il contenuto di un file

**Non adatto per:**
- Modificare contenuto parziale di un file — usare Edit
- Non creare proattivamente file di documentazione (*.md) o README, a meno che l'utente non lo richieda esplicitamente

## Note

- Se il file di destinazione esiste già, è necessario prima leggerlo tramite Read, altrimenti l'operazione fallisce
- Sovrascrive l'intero contenuto del file esistente
- Preferire Edit per modificare file esistenti, Write è solo per creare nuovi file o riscritture complete

## Significato in cc-viewer

Le chiamate Write appaiono nei log delle richieste come content block `tool_use`, il cui `input.content` contiene il contenuto completo scritto.

## Testo originale

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
