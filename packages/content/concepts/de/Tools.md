# Claude Code Tool-Übersicht

Claude Code stellt dem Modell über den tool_use-Mechanismus der Anthropic API eine Reihe integrierter Tools zur Verfügung. Das `tools`-Array jeder MainAgent-Anfrage enthält die vollständigen JSON-Schema-Definitionen dieser Tools, und das Modell ruft sie in der Antwort über `tool_use` Content Blocks auf.

Im Folgenden finden Sie den kategorisierten Index aller Tools.

## Agent-System

| Tool | Zweck |
|------|-------|
| [Agent](Tool-Agent.md) | Startet einen Sub-Agent (SubAgent) für komplexe mehrstufige Aufgaben |
| [TaskOutput](Tool-TaskOutput.md) | Ruft die Ausgabe von Hintergrundaufgaben ab |
| [TaskStop](Tool-TaskStop.md) | Stoppt eine laufende Hintergrundaufgabe |
| [TaskCreate](Tool-TaskCreate.md) | Erstellt einen strukturierten Aufgabenlisteneintrag |
| [TaskGet](Tool-TaskGet.md) | Ruft Aufgabendetails ab |
| [TaskUpdate](Tool-TaskUpdate.md) | Aktualisiert Aufgabenstatus, Abhängigkeiten usw. |
| [TaskList](Tool-TaskList.md) | Listet alle Aufgaben auf |
| [ListAgents](Tool-ListAgents.md) | Listet die in der Sitzung verfügbaren Agenten auf |

## Team & Orchestrierung

| Tool | Zweck |
|------|-------|
| [SendMessage](Tool-SendMessage.md) | Sendet eine Nachricht an einen anderen Agent |
| [Workflow](Tool-Workflow.md) | Führt ein deterministisches Multi-Agent-Orchestrations-Skript aus |
| [Monitor](Tool-Monitor.md) | Streamt Ereignisse von einem lang laufenden Skript als Benachrichtigungen |
| [SendFile](Tool-SendFile.md) | Sendet Dateien an eine andere Claude Code-Sitzung |
| [SendUserFile](Tool-SendUserFile.md) | Sendet Dateien an den Benutzer |
| [SendUserMessage](Tool-SendUserMessage.md) | Sendet eine Nachricht an den Benutzer (Legacy-Tool Brief) |
| [EndConversation](Tool-EndConversation.md) | Beendet die aktuelle Unterhaltung |

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
| [ToolSearch](Tool-ToolSearch.md) | Sucht und lädt aufgeschobene/MCP-Tools auf Abruf |

## Terminal

| Tool | Zweck |
|------|-------|
| [Bash](Tool-Bash.md) | Führt Shell-Befehle aus |
| [REPL](Tool-REPL.md) | Führt JavaScript in einer persistenten Node.js-REPL aus |

## Web

| Tool | Zweck |
|------|-------|
| [WebFetch](Tool-WebFetch.md) | Ruft Webinhalte ab und verarbeitet sie mit KI |
| [WebSearch](Tool-WebSearch.md) | Suchmaschinenabfrage |
| [Artifact](Tool-Artifact.md) | Veröffentlicht eine HTML/Markdown-Datei als gehostete claude.ai-Webseite |
| [DesignSync](Tool-DesignSync.md) | Synchronisiert eine lokale Komponentenbibliothek mit einem claude.ai Design-System-Projekt |

## Planung und Interaktion

| Tool | Zweck |
|------|-------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Wechselt in den Planungsmodus zur Entwurfsplanung |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Verlässt den Planungsmodus und reicht den Plan zur Benutzerfreigabe ein |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Stellt dem Benutzer Fragen zur Klärung oder Entscheidungsfindung |
| [ReportFindings](Tool-ReportFindings.md) | Berichtet Code-Review-Erkenntnisse als typisierte Liste für die Host-Benutzeroberfläche |
| [TodoWrite](Tool-TodoWrite.md) | Schreibt eine strukturierte Aufgabenliste für die Sitzung |
| [SendFeedback](Tool-SendFeedback.md) | Sendet strukturiertes Feedback über Claude Code an Anthropic |
| [Projects](Tool-Projects.md) | Verwaltet Wissensbasis-Dokumente des Projekts |
| [ProposeGoal](Tool-ProposeGoal.md) | Schlägt ein überprüfbares Abschlussziel für die Sitzung vor |

## Worktrees

| Tool | Zweck |
|------|-------|
| [EnterWorktree](Tool-EnterWorktree.md) | Erstellt oder betritt einen isolierten Git-Worktree für die Sitzung |
| [ExitWorktree](Tool-ExitWorktree.md) | Verlässt die Worktree-Sitzung, hält sie oder entfernt sie |

## Planung und Benachrichtigungen

| Tool | Zweck |
|------|-------|
| [CronCreate](Tool-CronCreate.md) | Zeitplant einen Aufforderung auf einem Cron-Ausdruck (wiederkehrend oder einmalig) |
| [CronDelete](Tool-CronDelete.md) | Storniert einen geplanten Cron-Job |
| [CronList](Tool-CronList.md) | Listet geplante Cron-Jobs auf |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Selbstteilt /loop Iterationen durch Planung des nächsten Aufwachens |
| [PushNotification](Tool-PushNotification.md) | Sendet eine Desktop-/Mobilbenachrichtigung an den Benutzer |
| [RemoteTrigger](Tool-RemoteTrigger.md) | Verwaltet claude.ai Remote-Trigger-Routinen |
| [ReadNotifications](Tool-ReadNotifications.md) | Liest ausstehende Sitzungsbenachrichtigungen |

## Erweiterungen

| Tool | Zweck |
|------|-------|
| [Skill](Tool-Skill.md) | Führt einen Skill (Slash Command) aus |

## MCP & Erweiterungen

| Tool | Zweck |
|------|-------|
| [ListMcpResources](Tool-ListMcpResources.md) | Listet Ressourcen auf, die von verbundenen MCP-Servern bereitgestellt werden |
| [ReadMcpResource](Tool-ReadMcpResource.md) | Liest eine einzelne MCP-Server-Ressource per URI |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | Listet eine verzeichnisartige MCP-Ressource per URI auf |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | Durchsucht die MCP-Connector-Registry per Stichwort |
| [SuggestConnectors](Tool-SuggestConnectors.md) | Löst Connector-Details aus Registry-Suchergebnissen auf |
| [ListConnectors](Tool-ListConnectors.md) | Listet installierte MCP-Connectors auf |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | Rendert eine Inline-Pluginkarte zur Installation |
| [SuggestSkills](Tool-SuggestSkills.md) | Rendert eine Karte hinzufügbarer Skills |
| [ListPlugins](Tool-ListPlugins.md) | Listet aktivierte claude.ai-Plugins auf |
| [ListSkills](Tool-ListSkills.md) | Listet aktivierte claude.ai-Skills auf |

## IDE-Integration

| Tool | Zweck |
|------|-------|
| [LSP](Tool-LSP.md) | Sprachserver-Abfragen (Definitionen, Referenzen, Symbole) |
