# Read

## Definisjon

Leser filinnhold fra det lokale filsystemet. Støtter tekstfiler, bilder, PDF og Jupyter notebook.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `file_path` | string | Ja | Absolutt sti til filen |
| `offset` | number | Nei | Startlinjenummer (for segmentert lesing av store filer) |
| `limit` | number | Nei | Antall linjer å lese (for segmentert lesing av store filer) |
| `pages` | string | Nei | PDF-sideområde (f.eks. "1-5", "3", "10-20"), gjelder kun for PDF |

## Bruksscenarioer

**Egnet for bruk:**
- Lese kodefiler, konfigurasjonsfiler og andre tekstfiler
- Vise bildefiler (Claude er en multimodal modell)
- Lese PDF-dokumenter
- Lese Jupyter notebook (returnerer alle celler med utdata)
- Lese flere filer parallelt for å få kontekst

**Ikke egnet for bruk:**
- Lese kataloger — bruk `ls`-kommandoen i Bash
- Åpen kodebaseutforskning — bruk Task (Explore-type)

## Merknader

- Stien må være absolutt, ikke relativ
- Leser som standard de første 2000 linjene i filen
- Linjer over 2000 tegn blir avkortet
- Utdata bruker `cat -n`-format, linjenumre starter fra 1
- Store PDF-er (over 10 sider) må spesifisere `pages`-parameteren, maks 20 sider per gang
- Lesing av en ikke-eksisterende fil returnerer feil (krasjer ikke)
- Kan kalle flere Read parallelt i en enkelt melding

## Betydning i cc-viewer

Read-kall vises i forespørselsloggen som et par av `tool_use` (kall) og `tool_result` (returnert innhold) content blocks. `tool_result` inneholder det faktiske filinnholdet og kan brukes til å analysere hvilke filer modellen har lest.

## Originaltekst

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
