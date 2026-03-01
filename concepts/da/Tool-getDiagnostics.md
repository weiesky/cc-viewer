# getDiagnostics (mcp__ide__getDiagnostics)

## Definition

Henter sprogdiagnostikinformation fra VS Code, herunder syntaksfejl, typefejl, lint-advarsler osv.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `uri` | string | Nej | Fil-URI. Hvis ikke angivet, hentes diagnostikinformation for alle filer |

## Brugsscenarier

**Egnet til:**
- Kontrollere kodens semantiske problemer som syntaks, typer, lint
- Verificere om der er introduceret nye fejl efter koderediger
- Erstatte Bash-kommandoer til kontrol af kodekvalitet

**Ikke egnet til:**
- Køre tests — brug Bash
- Kontrollere runtime-fejl — brug Bash til at udføre koden

## Bemærkninger

- Dette er et MCP-værktøj (Model Context Protocol), leveret af IDE-integrationen
- Kun tilgængeligt i VS Code / IDE-miljøer
- Foretræk dette værktøj frem for Bash-kommandoer til kontrol af kodeproblemer

## Betydning i cc-viewer

getDiagnostics er et MCP-værktøj, der vises i requestloggens `tools`-array med navnet `mcp__ide__getDiagnostics`. Dets kald og returneringer følger standard `tool_use` / `tool_result`-mønsteret. Tilføjelse/fjernelse af MCP-værktøjer medfører ændringer i tools-arrayet, som kan udløse cache-genopbygning.

## Originaltekst

<textarea readonly>Get language diagnostics from VS Code</textarea>
