# executeCode (mcp__ide__executeCode)

## Definition

Udfører Python-kode i Jupyter-kernen for den aktuelle notebook-fil.

## Parametre

| Parameter | Type | Påkrævet | Beskrivelse |
|------|------|------|------|
| `code` | string | Ja | Python-kode der skal udføres |

## Brugsscenarier

**Egnet til:**
- Udføre kode i et Jupyter notebook-miljø
- Teste kodestykker
- Dataanalyse og beregninger

**Ikke egnet til:**
- Kodeudførelse i ikke-Jupyter-miljøer — brug Bash
- Ændre filer — brug Edit eller Write

## Bemærkninger

- Dette er et MCP-værktøj (Model Context Protocol), leveret af IDE-integrationen
- Kode udføres i den aktuelle Jupyter-kerne, tilstanden bevares mellem kald
- Medmindre brugeren udtrykkeligt beder om det, undgå at deklarere variabler eller ændre kernens tilstand
- Tilstanden går tabt efter genstart af kernen

## Betydning i cc-viewer

executeCode er et MCP-værktøj, der vises i requestloggens `tools`-array med navnet `mcp__ide__executeCode`. Dets kald og returneringer følger standard `tool_use` / `tool_result`-mønsteret. Tilføjelse/fjernelse af MCP-værktøjer medfører ændringer i tools-arrayet, som kan udløse cache-genopbygning.

## Originaltekst

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
