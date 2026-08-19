# Grep

Søker i filinnhold med ripgrep-motoren. Tilbyr full støtte for regulære uttrykk, filtrering etter filtype og tre utdatamoduser slik at du kan bytte presisjon mot kompakthet.

## Når skal den brukes

- Lokalisere hvert kallsted for en funksjon eller hver referanse til en identifikator
- Sjekke om en streng eller feilmelding vises noe sted i kodebasen
- Telle forekomster av et mønster for å vurdere påvirkning før refaktorering
- Snevre inn et søk til en filtype (`type: "ts"`) eller glob (`glob: "**/*.tsx"`)
- Hente treff på tvers av linjer, som flerlinjede struct-definisjoner eller JSX-blokker med `multiline: true`

## Parametere

- `pattern` (string, påkrevd): Det regulære uttrykket å søke etter. Bruker ripgrep-syntaks, så bokstavelige krøllparenteser må escapes (for eksempel `interface\{\}` for å finne `interface{}`).
- `path` (string, valgfri): Fil eller katalog å søke i. Standard er gjeldende arbeidskatalog.
- `glob` (string, valgfri): Filnavnsfilter som `*.js` eller `*.{ts,tsx}`.
- `type` (string, valgfri): Snarvei for filtype som `js`, `py`, `rust`, `go`. Mer effektiv enn `glob` for standardspråk.
- `output_mode` (enum, valgfri): `files_with_matches` (standard, returnerer kun stier), `content` (returnerer treffende linjer), eller `count` (returnerer treffantall).
- `-i` (boolean, valgfri): Ikke skille mellom store og små bokstaver.
- `-n` (boolean, valgfri): Inkluder linjenummer i `content`-modus. Standard er `true`.
- `-A` (number, valgfri): Linjer med kontekst etter hvert treff (krever `content`-modus).
- `-B` (number, valgfri): Linjer med kontekst før hvert treff (krever `content`-modus).
- `-C` / `context` (number, valgfri): Linjer med kontekst på begge sider av hvert treff.
- `multiline` (boolean, valgfri): Tillat mønstre å gå over linjeskift (`.` matcher `\n`). Standard er `false`.
- `head_limit` (number, valgfri): Begrens returnerte linjer, filstier eller telleoppføringer. Standard er 250; send `0` for ubegrenset (bruk sparsomt).
- `offset` (number, valgfri): Hopp over de første N resultatene før `head_limit` anvendes. Standard er `0`.

## Eksempler

### Eksempel 1: Finn alle kallsteder for en funksjon
Sett `pattern: "registerHandler\\("`, `output_mode: "content"` og `-C: 2` for å se linjene rundt hvert kall.

### Eksempel 2: Tell treff på tvers av en type
Sett `pattern: "TODO"`, `type: "py"` og `output_mode: "count"` for å se totale TODO-tall per fil på tvers av Python-kilder.

### Eksempel 3: Flerlinjers struct-treff
Bruk `pattern: "struct Config \\{[\\s\\S]*?version"` med `multiline: true` for å fange et felt som er deklarert flere linjer inn i en Go-struct.

## Notater

- Foretrekk alltid `Grep` fremfor å kjøre `grep` eller `rg` via `Bash`; verktøyet er optimalisert for riktige tillatelser og strukturert utdata.
- Standard utdatamodus er `files_with_matches`, som er billigst. Bytt til `content` kun når du trenger å se linjene selv.
- Kontekstflagg (`-A`, `-B`, `-C`) ignoreres med mindre `output_mode` er `content`.
- Store resultatsett brenner kontekstokens. Bruk `head_limit`, `offset` eller strammere `glob`/`type`-filtre for å holde fokus.
- For filnavnsoppdagelse, bruk `Glob` i stedet; for åpne undersøkelser over mange runder, dispatch en `Agent` med Explore-agenten.
