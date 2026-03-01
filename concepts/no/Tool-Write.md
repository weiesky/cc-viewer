# Write

## Definisjon

Skriver innhold til det lokale filsystemet. Overskriver filen hvis den allerede eksisterer.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `file_path` | string | Ja | Absolutt sti til filen (må være absolutt sti) |
| `content` | string | Ja | Innholdet som skal skrives |

## Bruksscenarioer

**Egnet for bruk:**
- Opprette nye filer
- Når filinnholdet må skrives helt om

**Ikke egnet for bruk:**
- Endre deler av filinnholdet — bruk Edit
- Bør ikke proaktivt opprette dokumentasjonsfiler (*.md) eller README, med mindre brukeren eksplisitt ber om det

## Merknader

- Hvis målfilen allerede eksisterer, må den først leses via Read, ellers mislykkes det
- Overskriver alt eksisterende filinnhold
- Foretrekk Edit for å redigere eksisterende filer, Write brukes kun for å opprette nye filer eller fullstendig omskriving

## Betydning i cc-viewer

Write-kall vises i forespørselsloggen som `tool_use` content block, der `input.content` inneholder det fullstendige skrevne innholdet.

## Originaltekst

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
