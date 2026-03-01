# executeCode (mcp__ide__executeCode)

## Definition

Führt Python-Code im Jupyter-Kernel der aktuellen Notebook-Datei aus.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `code` | string | Ja | Der auszuführende Python-Code |

## Anwendungsfälle

**Geeignet für:**
- Code in einer Jupyter-Notebook-Umgebung ausführen
- Code-Snippets testen
- Datenanalyse und Berechnungen

**Nicht geeignet für:**
- Codeausführung außerhalb von Jupyter – dafür Bash verwenden
- Dateien ändern – dafür Edit oder Write verwenden

## Hinweise

- Dies ist ein MCP-Tool (Model Context Protocol), bereitgestellt durch die IDE-Integration
- Code wird im aktuellen Jupyter-Kernel ausgeführt, der Zustand bleibt zwischen Aufrufen bestehen
- Sofern der Benutzer es nicht ausdrücklich anfordert, sollte das Deklarieren von Variablen oder Ändern des Kernel-Zustands vermieden werden
- Nach einem Kernel-Neustart geht der Zustand verloren

## Bedeutung in cc-viewer

executeCode ist ein MCP-Tool und erscheint im `tools`-Array des Anfrage-Logs unter dem Namen `mcp__ide__executeCode`. Aufrufe und Rückgaben folgen dem Standard-`tool_use` / `tool_result`-Muster. Änderungen an MCP-Tools führen zu Änderungen im tools-Array und können einen Cache-Neuaufbau auslösen.

## Originaltext

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
