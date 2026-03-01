# getDiagnostics (mcp__ide__getDiagnostics)

## Definition

Ruft Sprachdiagnoseinformationen von VS Code ab, einschließlich Syntaxfehler, Typfehler, Lint-Warnungen usw.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `uri` | string | Nein | Datei-URI. Wenn nicht angegeben, werden Diagnoseinformationen aller Dateien abgerufen |

## Anwendungsfälle

**Geeignet für:**
- Syntax-, Typ-, Lint- und andere semantische Probleme im Code prüfen
- Nach Codebearbeitung überprüfen, ob neue Fehler eingeführt wurden
- Als Alternative zu Bash-Befehlen zur Codequalitätsprüfung

**Nicht geeignet für:**
- Tests ausführen – dafür Bash verwenden
- Laufzeitfehler prüfen – dafür Code über Bash ausführen

## Hinweise

- Dies ist ein MCP-Tool (Model Context Protocol), bereitgestellt durch die IDE-Integration
- Nur in VS Code / IDE-Umgebungen verfügbar
- Dieses Tool gegenüber Bash-Befehlen zur Codeprüfung bevorzugen

## Bedeutung in cc-viewer

getDiagnostics ist ein MCP-Tool und erscheint im `tools`-Array des Anfrage-Logs unter dem Namen `mcp__ide__getDiagnostics`. Aufrufe und Rückgaben folgen dem Standard-`tool_use` / `tool_result`-Muster. Änderungen an MCP-Tools führen zu Änderungen im tools-Array und können einen Cache-Neuaufbau auslösen.

## Originaltext

<textarea readonly>Get language diagnostics from VS Code</textarea>
