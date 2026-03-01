# Edit

## Definition

Redigerer filer via præcis strengerstatning. Erstatter `old_string` med `new_string` i filen.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `file_path` | string | Ja | Absolut sti til filen der skal ændres |
| `old_string` | string | Ja | Originaltekst der skal erstattes |
| `new_string` | string | Ja | Ny erstatningstekst (skal være forskellig fra old_string) |
| `replace_all` | boolean | Nej | Om alle forekomster skal erstattes, standard `false` |

## Brugsscenarier

**Egnet til:**
- Ændre specifikke kodeafsnit i eksisterende filer
- Rette fejl, opdatere logik
- Omdøbe variabler (med `replace_all: true`)
- Ethvert scenarie der kræver præcis ændring af filindhold

**Ikke egnet til:**
- Oprette nye filer — brug Write
- Omfattende omskrivninger — kan kræve Write til at overskrive hele filen

## Bemærkninger

- Filen skal først være læst via Read, ellers opstår en fejl
- `old_string` skal være unik i filen, ellers fejler redigeringen. Hvis den ikke er unik, angiv mere kontekst for at gøre den unik, eller brug `replace_all`
- Ved redigering af tekst skal den originale indrykning (tab/mellemrum) bevares; medtag ikke linjenummerpræfikset fra Read-output
- Foretræk redigering af eksisterende filer frem for at oprette nye
- `new_string` skal være forskellig fra `old_string`

## Betydning i cc-viewer

Edit-kald vises i requestloggen som `tool_use` content block, hvis `input` indeholder `old_string` og `new_string`, som kan bruges til at spore hvilke ændringer modellen har foretaget i filer.

## Originaltekst

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
