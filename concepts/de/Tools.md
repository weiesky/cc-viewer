# Claude Code Tool-Übersicht

Claude Code stellt dem Modell über den tool_use-Mechanismus der Anthropic API eine Reihe integrierter Tools zur Verfügung. Das `tools`-Array jeder MainAgent-Anfrage enthält die vollständigen JSON-Schema-Definitionen dieser Tools, und das Modell ruft sie in der Antwort über `tool_use` Content Blocks auf.

Im Folgenden finden Sie den kategorisierten Index aller Tools.

## Agent-System

| Tool | Zweck |
|------|-------|
| [Task](Tool-Task.md) | Startet einen Sub-Agent (SubAgent) für komplexe mehrstufige Aufgaben |
| [TaskOutput](Tool-TaskOutput.md) | Ruft die Ausgabe von Hintergrundaufgaben ab |
| [TaskStop](Tool-TaskStop.md) | Stoppt eine laufende Hintergrundaufgabe |
| [TaskCreate](Tool-TaskCreate.md) | Erstellt einen strukturierten Aufgabenlisteneintrag |
| [TaskGet](Tool-TaskGet.md) | Ruft Aufgabendetails ab |
| [TaskUpdate](Tool-TaskUpdate.md) | Aktualisiert Aufgabenstatus, Abhängigkeiten usw. |
| [TaskList](Tool-TaskList.md) | Listet alle Aufgaben auf |

## Dateioperationen

| Tool | Zweck |
|------|-------|
| [Read](Tool-Read.md) | Liest Dateiinhalte (unterstützt Text, Bilder, PDF, Jupyter Notebook) |
| [Edit](Tool-Edit.md) | Bearbeitet Dateien durch exakte Zeichenkettenersetzung |
| [Write](Tool-Write.md) | Schreibt oder überschreibt Dateien |
| [NotebookEdit](Tool-NotebookEdit.md) | Bearbeitet Jupyter-Notebook-Zellen |

## Suche

| Tool | Zweck |
|------|-------|
| [Glob](Tool-Glob.md) | Sucht Dateien nach Dateinamenmustern |
| [Grep](Tool-Grep.md) | Dateiinhaltssuche basierend auf ripgrep |

## Terminal

| Tool | Zweck |
|------|-------|
| [Bash](Tool-Bash.md) | Führt Shell-Befehle aus |

## Web

| Tool | Zweck |
|------|-------|
| [WebFetch](Tool-WebFetch.md) | Ruft Webinhalte ab und verarbeitet sie mit KI |
| [WebSearch](Tool-WebSearch.md) | Suchmaschinenabfrage |

## Planung und Interaktion

| Tool | Zweck |
|------|-------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Wechselt in den Planungsmodus zur Entwurfsplanung |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Verlässt den Planungsmodus und reicht den Plan zur Benutzerfreigabe ein |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Stellt dem Benutzer Fragen zur Klärung oder Entscheidungsfindung |

## Erweiterungen

| Tool | Zweck |
|------|-------|
| [Skill](Tool-Skill.md) | Führt einen Skill (Slash Command) aus |

## IDE-Integration

| Tool | Zweck |
|------|-------|
| [getDiagnostics](Tool-getDiagnostics.md) | Ruft VS Code Sprachdiagnoseinformationen ab |
| [executeCode](Tool-executeCode.md) | Führt Code im Jupyter-Kernel aus |
