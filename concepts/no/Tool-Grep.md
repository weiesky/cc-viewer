# Grep

## Definisjon

Kraftig innholdssøkverktøy bygget på ripgrep. Støtter regulære uttrykk, filtypfiltrering og flere utdatamoduser.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `pattern` | string | Ja | Søkemønster med regulært uttrykk |
| `path` | string | Nei | Søkesti (fil eller katalog), standard er gjeldende arbeidskatalog |
| `glob` | string | Nei | Filnavnfilter (f.eks. `*.js`, `*.{ts,tsx}`) |
| `type` | string | Nei | Filtypfilter (f.eks. `js`, `py`, `rust`), mer effektivt enn glob |
| `output_mode` | enum | Nei | Utdatamodus: `files_with_matches` (standard), `content`, `count` |
| `-i` | boolean | Nei | Søk uten hensyn til store/små bokstaver |
| `-n` | boolean | Nei | Vis linjenumre (kun content-modus), standard true |
| `-A` | number | Nei | Antall linjer vist etter treff |
| `-B` | number | Nei | Antall linjer vist før treff |
| `-C` / `context` | number | Nei | Antall linjer vist før og etter treff |
| `head_limit` | number | Nei | Begrens antall utdataoppføringer, standard 0 (ubegrenset) |
| `offset` | number | Nei | Hopp over de første N resultatene |
| `multiline` | boolean | Nei | Aktiver flerlinjematchingsmodus, standard false |

## Bruksscenarioer

**Egnet for bruk:**
- Søke etter spesifikke strenger eller mønstre i kodebasen
- Finne brukssteder for funksjoner/variabler
- Filtrere søkeresultater etter filtype
- Telle antall treff

**Ikke egnet for bruk:**
- Finne filer etter navn — bruk Glob
- Åpen utforskning som krever flere søkerunder — bruk Task (Explore-type)

## Merknader

- Bruker ripgrep-syntaks (ikke grep), spesialtegn som krøllparenteser må escapes
- `files_with_matches`-modus returnerer kun filstier, mest effektivt
- `content`-modus returnerer innholdet i matchende linjer, med støtte for kontekstlinjer
- Flerlinjematching krever at `multiline: true` settes
- Foretrekk alltid Grep-verktøyet fremfor `grep`- eller `rg`-kommandoer i Bash

## Betydning i cc-viewer

Grep-kall vises i forespørselsloggen som et par av `tool_use` / `tool_result` content blocks. `tool_result` inneholder søkeresultatene.

## Originaltekst

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
