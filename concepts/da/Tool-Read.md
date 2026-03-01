# Read

## Definition

Læser filindhold fra det lokale filsystem. Understøtter tekstfiler, billeder, PDF og Jupyter notebook.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `file_path` | string | Ja | Absolut sti til filen |
| `offset` | number | Nej | Startlinjenummer (til segmenteret læsning af store filer) |
| `limit` | number | Nej | Antal linjer der skal læses (til segmenteret læsning af store filer) |
| `pages` | string | Nej | PDF-sideinterval (f.eks. "1-5", "3", "10-20"), gælder kun for PDF |

## Brugsscenarier

**Egnet til:**
- Læse kodefiler, konfigurationsfiler og andre tekstfiler
- Se billedfiler (Claude er en multimodal model)
- Læse PDF-dokumenter
- Læse Jupyter notebooks (returnerer alle celler med output)
- Læse flere filer parallelt for at få kontekst

**Ikke egnet til:**
- Læse mapper — brug Bashs `ls`-kommando
- Åben udforskning af kodebasen — brug Task (Explore-type)

## Bemærkninger

- Stien skal være absolut, ikke relativ
- Læser som standard de første 2000 linjer af filen
- Linjer over 2000 tegn afkortes
- Output bruger `cat -n`-format med linjenumre startende fra 1
- Store PDF'er (over 10 sider) kræver angivelse af `pages`-parameteren, maks. 20 sider ad gangen
- Læsning af en ikke-eksisterende fil returnerer en fejl (crasher ikke)
- Man kan kalde flere Read parallelt i en enkelt besked

## Betydning i cc-viewer

Read-kald vises i requestloggen som `tool_use` (kald) og `tool_result` (returneret indhold) content block-par. `tool_result` indeholder filens faktiske indhold, som kan bruges til at analysere hvilke filer modellen har læst.

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
