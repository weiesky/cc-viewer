# Read

## Definizione

Legge il contenuto di un file dal file system locale. Supporta file di testo, immagini, PDF e Jupyter notebook.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `file_path` | string | Sì | Percorso assoluto del file |
| `offset` | number | No | Numero di riga iniziale (per la lettura segmentata di file grandi) |
| `limit` | number | No | Numero di righe da leggere (per la lettura segmentata di file grandi) |
| `pages` | string | No | Intervallo di pagine PDF (es. "1-5", "3", "10-20"), applicabile solo ai PDF |

## Scenari d'uso

**Adatto per:**
- Leggere file di codice, file di configurazione e altri file di testo
- Visualizzare file immagine (Claude è un modello multimodale)
- Leggere documenti PDF
- Leggere Jupyter notebook (restituisce tutte le celle con i relativi output)
- Leggere più file in parallelo per ottenere contesto

**Non adatto per:**
- Leggere directory — usare il comando `ls` di Bash
- Esplorazione aperta del codebase — usare Task (tipo Explore)

## Note

- Il percorso deve essere assoluto, non relativo
- Per impostazione predefinita legge le prime 2000 righe del file
- Le righe che superano i 2000 caratteri vengono troncate
- L'output usa il formato `cat -n`, con numeri di riga a partire da 1
- Per PDF grandi (oltre 10 pagine) è necessario specificare il parametro `pages`, massimo 20 pagine per volta
- La lettura di un file inesistente restituisce un errore (non causa un crash)
- È possibile chiamare più Read in parallelo in un singolo messaggio

## Significato in cc-viewer

Le chiamate Read appaiono nei log delle richieste come coppie di content block `tool_use` (chiamata) e `tool_result` (contenuto restituito). Il `tool_result` contiene il contenuto effettivo del file, utile per analizzare quali file il modello ha letto.

## Testo originale

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
