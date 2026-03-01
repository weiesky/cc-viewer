# ExitPlanMode

## Definición

Sale del modo de planificación y envía el plan al usuario para su aprobación. El contenido del plan se lee del archivo de plan escrito previamente.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `allowedPrompts` | array | No | Lista de descripciones de permisos necesarios para implementar el plan |

Cada elemento del array `allowedPrompts`:

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tool` | enum | Sí | Herramienta aplicable, actualmente solo soporta `Bash` |
| `prompt` | string | Sí | Descripción semántica de la operación (como "run tests", "install dependencies") |

## Casos de uso

**Adecuado para:**
- El plan está completo en modo de planificación, listo para enviar a aprobación del usuario
- Solo para tareas de implementación que requieren escribir código

**No adecuado para:**
- Tareas puramente de investigación/exploración — no se necesita salir del modo de planificación
- Querer preguntar al usuario "¿está bien el plan?" — esa es exactamente la función de esta herramienta, no usar AskUserQuestion para eso

## Notas

- Esta herramienta no acepta el contenido del plan como parámetro — lo lee del archivo de plan escrito previamente
- El usuario verá el contenido del archivo de plan para aprobarlo
- No usar AskUserQuestion para preguntar "¿está bien el plan?" antes de llamar a esta herramienta, es redundante
- No mencionar "plan" en las preguntas, ya que el usuario no puede ver el contenido del plan antes de ExitPlanMode

## Significado en cc-viewer

La llamada a ExitPlanMode marca el final de la fase de planificación. En el registro de solicitudes, las solicitudes después de esta llamada generalmente se convierten en operaciones de implementación (Edit, Write, Bash, etc.).

## Texto original

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
