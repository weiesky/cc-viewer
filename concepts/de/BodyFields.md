# Beschreibung der Request-Body-Felder

Beschreibung der Top-Level-Felder des Request-Bodys der Claude API `/v1/messages`.

## Feldliste

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| **model** | string | Name des verwendeten Modells, z. B. `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Nachrichtenverlauf der Konversation. Jede Nachricht enthält `role` (user/assistant) und `content` (ein Block-Array aus Text, Bildern, tool_use, tool_result usw.) |
| **system** | array | System-Prompt. Enthält die Kernanweisungen von Claude Code, Anweisungen zur Tool-Nutzung, Umgebungsinformationen, CLAUDE.md-Inhalte usw. Blöcke mit `cache_control` werden durch Prompt-Caching zwischengespeichert |
| **tools** | array | Liste der verfügbaren Tool-Definitionen. Jedes Tool enthält `name`, `description` und `input_schema` (JSON Schema). Der MainAgent hat typischerweise 20+ Tools, SubAgents nur wenige |
| **metadata** | object | Anfrage-Metadaten, enthält typischerweise `user_id` zur Benutzeridentifikation |
| **max_tokens** | number | Maximale Token-Anzahl pro Modellantwort, z. B. `16000`, `64000` |
| **thinking** | object | Konfiguration des erweiterten Denkens. `type: "enabled"` aktiviert den Denkmodus, `budget_tokens` steuert das Token-Limit für das Denken |
| **context_management** | object | Konfiguration der Kontextverwaltung. `truncation: "auto"` erlaubt Claude Code, zu lange Nachrichtenverläufe automatisch zu kürzen |
| **output_config** | object | Ausgabekonfiguration, z. B. `format`-Einstellungen |
| **stream** | boolean | Ob Streaming-Antworten aktiviert sind. Claude Code verwendet immer `true` |

## messages-Struktur

Der `content` jeder Nachricht ist ein Block-Array mit folgenden gängigen Typen:

- **text**: Normaler Textinhalt
- **tool_use**: Modell ruft ein Tool auf (enthält `name`, `input`)
- **tool_result**: Ergebnis der Tool-Ausführung (enthält `tool_use_id`, `content`)
- **image**: Bildinhalt (Base64 oder URL)
- **thinking**: Denkprozess des Modells (erweiterter Denkmodus)

## system-Struktur

Das System-Prompt-Array enthält typischerweise:

1. **Kern-Agent-Anweisungen** ("You are Claude Code...")
2. **Regeln zur Tool-Nutzung**
3. **CLAUDE.md-Inhalte** (projektspezifische Anweisungen)
4. **Skill-Hinweise** (Skills Reminder)
5. **Umgebungsinformationen** (OS, Shell, Git-Status usw.) — Tatsächlich ist Claude Code stark von Git abhängig. Wenn ein Git-Repository im Projekt vorhanden ist, kann Claude Code ein besseres Verständnis des Projekts zeigen, einschließlich der Möglichkeit, Remote-Änderungen und Commit-Verläufe zur Analyse heranzuziehen

Blöcke mit der Markierung `cache_control: { type: "ephemeral" }` werden von der Anthropic API 5 Minuten lang zwischengespeichert. Bei einem Cache-Treffer wird mit `cache_read_input_tokens` abgerechnet (deutlich günstiger als `input_tokens`).

> **Hinweis**: Bei speziellen Clients wie Claude Code verlässt sich der Anthropic-Server tatsächlich nicht vollständig auf das `cache_control`-Attribut in der Anfrage, um das Caching-Verhalten zu bestimmen. Der Server führt automatisch Caching-Strategien für bestimmte Felder aus (wie System-Prompt, Tool-Definitionen), auch wenn die Anfrage keine explizite `cache_control`-Markierung enthält. Wenn Sie dieses Attribut also nicht im Request-Body sehen, brauchen Sie sich nicht zu wundern — der Server hat das Caching bereits im Hintergrund durchgeführt, ohne diese Information dem Client offenzulegen. Dies ist eine Art stillschweigende Übereinkunft zwischen Claude Code und der Anthropic API.
