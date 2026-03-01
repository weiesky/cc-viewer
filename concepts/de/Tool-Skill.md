# Skill

## Definition

Führt einen Skill in der Hauptkonversation aus. Skills sind spezialisierte Fähigkeiten, die der Benutzer über Slash Commands (z.B. `/commit`, `/review-pr`) aufrufen kann.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `skill` | string | Ja | Skill-Name (z.B. "commit", "review-pr", "pdf") |
| `args` | string | Nein | Skill-Argumente |

## Anwendungsfälle

**Geeignet für:**
- Der Benutzer hat einen Slash Command im Format `/<skill-name>` eingegeben
- Die Anfrage des Benutzers entspricht der Funktionalität eines registrierten Skills

**Nicht geeignet für:**
- Integrierte CLI-Befehle (z.B. `/help`, `/clear`)
- Bereits laufende Skills
- Skill-Namen, die nicht in der Liste verfügbarer Skills stehen

## Hinweise

- Nach dem Aufruf wird der Skill zu einem vollständigen Prompt expandiert
- Unterstützt vollqualifizierte Namen (z.B. `ms-office-suite:pdf`)
- Die Liste verfügbarer Skills wird in system-reminder-Nachrichten bereitgestellt
- Wenn ein `<command-name>`-Tag sichtbar ist, bedeutet dies, dass der Skill bereits geladen ist – direkt ausführen statt dieses Tool erneut aufzurufen
- Einen Skill nicht erwähnen, ohne das Tool tatsächlich aufzurufen

## Bedeutung in cc-viewer

Skill-Aufrufe erscheinen im Anfrage-Log als `tool_use` Content Block. Der nach der Skill-Expansion generierte Prompt beeinflusst den System-Prompt oder Nachrichteninhalt nachfolgender Anfragen.

## Originaltext

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
