# TaskStop

## Definición

Detiene una tarea en segundo plano en ejecución.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `task_id` | string | No | ID de la tarea en segundo plano a detener |
| `shell_id` | string | No | Obsoleto, usar `task_id` en su lugar |

## Casos de uso

**Adecuado para:**
- Terminar tareas de larga duración que ya no son necesarias
- Cancelar tareas en segundo plano iniciadas por error

## Notas

- Devuelve estado de éxito o fallo
- El parámetro `shell_id` está obsoleto, se debe usar `task_id`

## Significado en cc-viewer

Las llamadas a TaskStop no producen solicitudes API por sí mismas, pertenecen a las operaciones internas de gestión de tareas de Claude Code.

## Texto original

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
