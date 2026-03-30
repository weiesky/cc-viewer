# Task

> **Hinweis:** In neueren Claude Code-Versionen wurde dieses Tool in **Agent** umbenannt. Siehe das [Tool-Agent](Tool-Agent)-Dokument.

## Definition

Startet einen Sub-Agent (SubAgent), der komplexe mehrstufige Aufgaben autonom bearbeitet. Sub-Agents sind unabhängige Unterprozesse mit jeweils eigenen Tool-Sets und Kontext.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `prompt` | string | Ja | Aufgabenbeschreibung für den Sub-Agent |
| `description` | string | Ja | Kurze Zusammenfassung in 3–5 Wörtern |
| `subagent_type` | string | Ja | Sub-Agent-Typ, bestimmt das verfügbare Tool-Set |
| `model` | enum | Nein | Modell angeben (sonnet / opus / haiku), Standard wird vom übergeordneten Agent geerbt |
| `max_turns` | integer | Nein | Maximale Anzahl agentischer Runden |
| `run_in_background` | boolean | Nein | Ob im Hintergrund ausgeführt werden soll; Hintergrundaufgaben geben den output_file-Pfad zurück |
| `resume` | string | Nein | Agent-ID zum Fortsetzen, setzt die letzte Ausführung fort |
| `isolation` | enum | Nein | Isolationsmodus, `worktree` erstellt einen temporären Git-Worktree |

## Sub-Agent-Typen

| Typ | Zweck | Verfügbare Tools |
|-----|-------|------------------|
| `Bash` | Befehlsausführung, Git-Operationen | Bash |
| `general-purpose` | Allgemeine mehrstufige Aufgaben | Alle Tools |
| `Explore` | Schnelle Codebasis-Erkundung | Alle Tools außer Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Implementierungsplan entwerfen | Alle Tools außer Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Claude Code Nutzungsanleitung Q&A | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Statusleiste konfigurieren | Read, Edit |

## Anwendungsfälle

**Geeignet für:**
- Komplexe Aufgaben, die mehrere autonome Schritte erfordern
- Codebasis-Erkundung und Tiefenrecherche (Explore-Typ verwenden)
- Parallele Arbeit, die eine isolierte Umgebung erfordert
- Lang laufende Aufgaben, die im Hintergrund ausgeführt werden müssen

**Nicht geeignet für:**
- Bestimmte Dateipfade lesen – direkt Read oder Glob verwenden
- In 2–3 bekannten Dateien suchen – direkt Read verwenden
- Bestimmte Klassendefinitionen suchen – direkt Glob verwenden

## Hinweise

- Nach Abschluss gibt der Sub-Agent eine einzelne Nachricht zurück; sein Ergebnis ist für den Benutzer nicht sichtbar und muss vom Haupt-Agent weitergegeben werden
- Mehrere parallele Task-Aufrufe können in einer einzelnen Nachricht gestartet werden, um die Effizienz zu steigern
- Hintergrundaufgaben werden über das TaskOutput-Tool auf Fortschritt geprüft
- Der Explore-Typ ist langsamer als direkte Glob/Grep-Aufrufe; nur verwenden, wenn einfache Suchen nicht ausreichen
