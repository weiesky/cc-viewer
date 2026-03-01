# Skill

## Definición

Ejecuta una habilidad (skill) en la conversación principal. Las habilidades son capacidades especializadas que el usuario puede invocar mediante slash commands (como `/commit`, `/review-pr`).

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `skill` | string | Sí | Nombre de la habilidad (como "commit", "review-pr", "pdf") |
| `args` | string | No | Argumentos de la habilidad |

## Casos de uso

**Adecuado para:**
- El usuario ingresó un slash command en formato `/<skill-name>`
- La solicitud del usuario coincide con la funcionalidad de una habilidad registrada

**No adecuado para:**
- Comandos CLI integrados (como `/help`, `/clear`)
- Una habilidad que ya está en ejecución
- Nombres de habilidades que no están en la lista de habilidades disponibles

## Notas

- Después de ser invocada, la habilidad se expande en un prompt completo
- Soporta nombres completamente calificados (como `ms-office-suite:pdf`)
- La lista de habilidades disponibles se proporciona en los mensajes system-reminder
- Cuando se ve una etiqueta `<command-name>`, significa que la habilidad ya está cargada y se debe ejecutar directamente en lugar de llamar a esta herramienta nuevamente
- No mencionar una habilidad sin haber llamado realmente a la herramienta

## Significado en cc-viewer

Las llamadas a Skill aparecen en el registro de solicitudes como content blocks `tool_use`. El prompt expandido de la habilidad afecta el system prompt o el contenido de los mensajes de solicitudes posteriores.

## Texto original

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
