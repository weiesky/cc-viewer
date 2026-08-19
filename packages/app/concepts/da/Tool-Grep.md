# Grep

Søger i filindhold ved hjælp af ripgrep-motoren. Tilbyder fuld understøttelse af regulære udtryk, filtrering efter filtype og tre output-tilstande, så du kan afveje præcision mod kompakthed.

## Hvornår skal den bruges

- Lokalisering af hvert kaldssted for en funktion eller hver reference til en identifikator
- Tjekke om en streng eller fejlmeddelelse forekommer nogen steder i kodebasen
- Tælle forekomster af et mønster for at vurdere påvirkning før refaktorering
- Indsnævre en søgning til en filtype (`type: "ts"`) eller glob (`glob: "**/*.tsx"`)
- Hente match på tværs af linjer, såsom multi-linje-struct-definitioner eller JSX-blokke, med `multiline: true`

## Parametre

- `pattern` (string, påkrævet): Det regulære udtryk, der skal søges efter. Bruger ripgrep-syntaks, så literale tuborgklammer skal escapes (for eksempel `interface\{\}` for at finde `interface{}`).
- `path` (string, valgfri): Fil eller mappe, der skal søges i. Standard er den aktuelle arbejdsmappe.
- `glob` (string, valgfri): Filnavnsfilter som `*.js` eller `*.{ts,tsx}`.
- `type` (string, valgfri): Genvej til filtype som `js`, `py`, `rust`, `go`. Mere effektivt end `glob` for standardsprog.
- `output_mode` (enum, valgfri): `files_with_matches` (standard, returnerer kun stier), `content` (returnerer matchende linjer) eller `count` (returnerer matchantal).
- `-i` (boolean, valgfri): Case-insensitiv matchning.
- `-n` (boolean, valgfri): Inkludér linjenumre i `content`-tilstand. Standard er `true`.
- `-A` (number, valgfri): Linjer med kontekst, der vises efter hvert match (kræver `content`-tilstand).
- `-B` (number, valgfri): Linjer med kontekst før hvert match (kræver `content`-tilstand).
- `-C` / `context` (number, valgfri): Linjer med kontekst på begge sider af hvert match.
- `multiline` (boolean, valgfri): Tillad mønstre at spænde over linjeskift (`.` matcher `\n`). Standard er `false`.
- `head_limit` (number, valgfri): Begræns returnerede linjer, filstier eller tælleposter. Standard er 250; send `0` for ubegrænset (brug sparsomt).
- `offset` (number, valgfri): Spring de første N resultater over, før `head_limit` anvendes. Standard er `0`.

## Eksempler

### Eksempel 1: Find alle kaldssteder for en funktion
Sæt `pattern: "registerHandler\\("`, `output_mode: "content"` og `-C: 2` for at se de omgivende linjer for hvert kald.

### Eksempel 2: Tæl match på tværs af en type
Sæt `pattern: "TODO"`, `type: "py"` og `output_mode: "count"` for at se TODO-totaler pr. fil på tværs af Python-kilder.

### Eksempel 3: Multi-linje struct-match
Brug `pattern: "struct Config \\{[\\s\\S]*?version"` med `multiline: true` for at fange et felt, der er erklæret flere linjer inde i en Go-struct.

## Noter

- Foretræk altid `Grep` frem for at køre `grep` eller `rg` gennem `Bash`; værktøjet er optimeret til korrekte tilladelser og struktureret output.
- Standard output-tilstand er `files_with_matches`, som er den billigste. Skift kun til `content`, når du skal se selve linjerne.
- Kontekstflag (`-A`, `-B`, `-C`) ignoreres, medmindre `output_mode` er `content`.
- Store resultatsæt brænder kontekst-tokens. Brug `head_limit`, `offset` eller strammere `glob`/`type`-filtre for at holde fokus.
- Til filnavnsopdagelse brug `Glob` i stedet; til åbne undersøgelser over mange runder udsend en `Agent` med Explore-agenten.
