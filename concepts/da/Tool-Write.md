# Write

## Definition

Skriver indhold til det lokale filsystem. Hvis filen allerede eksisterer, overskrives den.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `file_path` | string | Ja | Absolut sti til filen (skal være absolut) |
| `content` | string | Ja | Indhold der skal skrives |

## Brugsscenarier

**Egnet til:**
- Oprette nye filer
- Når filindholdet skal omskrives fuldstændigt

**Ikke egnet til:**
- Ændre delvist indhold i en fil — brug Edit
- Opret ikke proaktivt dokumentationsfiler (*.md) eller README, medmindre brugeren udtrykkeligt beder om det

## Bemærkninger

- Hvis målfilen allerede eksisterer, skal den først læses via Read, ellers fejler operationen
- Overskriver alt eksisterende filindhold
- Foretræk Edit til redigering af eksisterende filer, Write er kun til oprettelse af nye filer eller fuldstændig omskrivning

## Betydning i cc-viewer

Write-kald vises i requestloggen som `tool_use` content block, hvis `input.content` indeholder det komplette skrevne indhold.

## Originaltekst

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
