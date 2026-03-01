# TaskOutput

## Definición

Obtiene la salida de tareas en segundo plano en ejecución o completadas. Aplicable a shells en segundo plano, agents asíncronos y sesiones remotas.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `task_id` | string | Sí | ID de la tarea |
| `block` | boolean | Sí | Si se bloquea esperando que la tarea termine, por defecto `true` |
| `timeout` | number | Sí | Tiempo máximo de espera (milisegundos), por defecto 30000, máximo 600000 |

## Casos de uso

**Adecuado para:**
- Verificar el progreso de agents en segundo plano iniciados mediante Task (`run_in_background: true`)
- Obtener los resultados de ejecución de comandos Bash en segundo plano
- Esperar a que una tarea asíncrona termine y obtener su salida

**No adecuado para:**
- Tareas en primer plano — las tareas en primer plano devuelven resultados directamente, no se necesita esta herramienta

## Notas

- `block: true` bloquea hasta que la tarea termine o se agote el tiempo
- `block: false` se usa para verificación no bloqueante del estado actual
- El ID de la tarea se puede encontrar mediante el comando `/tasks`
- Aplicable a todos los tipos de tareas: shells en segundo plano, agents asíncronos, sesiones remotas

## Significado en cc-viewer

Las llamadas a TaskOutput no producen solicitudes API por sí mismas, es una operación interna de gestión de tareas de Claude Code y no aparece en el registro de solicitudes.

## Texto original

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
