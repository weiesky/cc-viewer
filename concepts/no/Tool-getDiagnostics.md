# getDiagnostics (mcp__ide__getDiagnostics)

## Definisjon

Henter språkdiagnostikk fra VS Code, inkludert syntaksfeil, typefeil, lint-advarsler osv.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `uri` | string | Nei | Fil-URI. Hvis ikke angitt, hentes diagnostikk for alle filer |

## Bruksscenarioer

**Egnet for bruk:**
- Sjekke syntaks-, type-, lint- og andre semantiske problemer i kode
- Verifisere etter koderedigering at ingen nye feil er introdusert
- Erstatte Bash-kommandoer for å sjekke kodekvalitet

**Ikke egnet for bruk:**
- Kjøre tester — bruk Bash
- Sjekke kjøretidsfeil — bruk Bash for å kjøre koden

## Merknader

- Dette er et MCP-verktøy (Model Context Protocol), levert av IDE-integrasjonen
- Kun tilgjengelig i VS Code / IDE-miljø
- Foretrekk dette verktøyet fremfor Bash-kommandoer for å sjekke kodeproblemer

## Originaltekst

<textarea readonly>Get language diagnostics from VS Code</textarea>
