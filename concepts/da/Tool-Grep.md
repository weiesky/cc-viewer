# Grep

## Definition

Kraftfuldt indholdssøgningsværktøj baseret på ripgrep. Understøtter regulære udtryk, filtypefiltring og flere outputtilstande.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `pattern` | string | Ja | Søgemønster med regulært udtryk |
| `path` | string | Nej | Søgesti (fil eller mappe), standard er den aktuelle arbejdsmappe |
| `glob` | string | Nej | Filnavnsfilter (f.eks. `*.js`, `*.{ts,tsx}`) |
| `type` | string | Nej | Filtypefilter (f.eks. `js`, `py`, `rust`), mere effektivt end glob |
| `output_mode` | enum | Nej | Outputtilstand: `files_with_matches` (standard), `content`, `count` |
| `-i` | boolean | Nej | Søgning uden forskel på store/små bogstaver |
| `-n` | boolean | Nej | Vis linjenumre (kun content-tilstand), standard true |
| `-A` | number | Nej | Antal linjer der vises efter match |
| `-B` | number | Nej | Antal linjer der vises før match |
| `-C` / `context` | number | Nej | Antal linjer der vises før og efter match |
| `head_limit` | number | Nej | Begræns antal outputposter, standard 0 (ubegrænset) |
| `offset` | number | Nej | Spring de første N resultater over |
| `multiline` | boolean | Nej | Aktiver flerlinjet matchningstilstand, standard false |

## Brugsscenarier

**Egnet til:**
- Søge efter specifikke strenge eller mønstre i kodebasen
- Finde hvor funktioner/variabler bruges
- Filtrere søgeresultater efter filtype
- Tælle antal matches

**Ikke egnet til:**
- Søge filer efter filnavn — brug Glob
- Åben udforskning der kræver flere søgerunder — brug Task (Explore-type)

## Bemærkninger

- Bruger ripgrep-syntaks (ikke grep), specialtegn som krøllede parenteser skal escapes
- `files_with_matches`-tilstand returnerer kun filstier, mest effektiv
- `content`-tilstand returnerer matchende linjeindhold, understøtter kontekstlinjer
- Flerlinjet matching kræver indstillingen `multiline: true`
- Brug altid Grep-værktøjet frem for `grep`- eller `rg`-kommandoer i Bash

## Betydning i cc-viewer

Grep-kald vises i requestloggen som `tool_use` / `tool_result` content block-par. `tool_result` indeholder søgeresultaterne.

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
