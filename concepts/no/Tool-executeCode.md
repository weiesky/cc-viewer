# executeCode (mcp__ide__executeCode)

## Definisjon

Kjører Python-kode i Jupyter-kernelen for gjeldende notebook-fil.

## Parametere

| Parameter | Type | Påkrevd | Beskrivelse |
|-----------|------|---------|-------------|
| `code` | string | Ja | Python-koden som skal kjøres |

## Bruksscenarioer

**Egnet for bruk:**
- Kjøre kode i Jupyter notebook-miljø
- Teste kodesnutter
- Dataanalyse og beregninger

**Ikke egnet for bruk:**
- Kodekjøring utenfor Jupyter-miljø — bruk Bash
- Endre filer — bruk Edit eller Write

## Merknader

- Dette er et MCP-verktøy (Model Context Protocol), levert av IDE-integrasjonen
- Koden kjøres i gjeldende Jupyter-kernel, og tilstanden vedvarer mellom kall
- Med mindre brukeren eksplisitt ber om det, bør du unngå å deklarere variabler eller endre kernel-tilstand
- Tilstanden går tapt etter omstart av kernelen

## Betydning i cc-viewer

executeCode er et MCP-verktøy som vises i `tools`-arrayen i forespørselsloggen med navnet `mcp__ide__executeCode`. Kall og resultater følger standard `tool_use` / `tool_result`-mønsteret. Tillegg eller fjerning av MCP-verktøy fører til endringer i tools-arrayen, noe som kan utløse cache-gjenoppbygging.

## Originaltekst

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
