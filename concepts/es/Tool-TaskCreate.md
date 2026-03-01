# TaskCreate

## Definición

Crea entradas estructuradas en la lista de tareas para rastrear el progreso, organizar tareas complejas y mostrar el avance del trabajo al usuario.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `subject` | string | Sí | Título breve de la tarea, usar forma imperativa (como "Fix authentication bug") |
| `description` | string | Sí | Descripción detallada, incluyendo contexto y criterios de aceptación |
| `activeForm` | string | No | Texto en gerundio mostrado cuando está en progreso (como "Fixing authentication bug") |
| `metadata` | object | No | Metadatos arbitrarios adjuntos a la tarea |

## Casos de uso

**Adecuado para:**
- Tareas complejas de múltiples pasos (más de 3 pasos)
- El usuario proporcionó múltiples elementos pendientes
- Rastrear trabajo en modo de planificación
- El usuario solicita explícitamente usar una lista de tareas

**No adecuado para:**
- Una sola tarea simple
- Operaciones simples de 3 pasos o menos
- Consultas puramente conversacionales o informativas

## Notas

- Todas las tareas nuevas tienen estado inicial `pending`
- `subject` usa forma imperativa ("Run tests"), `activeForm` usa gerundio ("Running tests")
- Después de crear la tarea, se pueden establecer relaciones de dependencia (blocks/blockedBy) mediante TaskUpdate
- Antes de crear, se debe llamar a TaskList para verificar si hay tareas duplicadas

## Significado en cc-viewer

TaskCreate es una operación interna de gestión de tareas de Claude Code, no produce solicitudes API independientes. Sin embargo, en el Chat Mode se puede ver el bloque tool_use donde el modelo llama a esta herramienta.

## Texto original

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
