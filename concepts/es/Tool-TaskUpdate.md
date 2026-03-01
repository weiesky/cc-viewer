# TaskUpdate

## Definición

Actualiza el estado, contenido o relaciones de dependencia de una tarea en la lista de tareas.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `taskId` | string | Sí | ID de la tarea a actualizar |
| `status` | enum | No | Nuevo estado: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | No | Nuevo título |
| `description` | string | No | Nueva descripción |
| `activeForm` | string | No | Texto en gerundio mostrado cuando está en progreso |
| `owner` | string | No | Nuevo responsable de la tarea (nombre del agent) |
| `metadata` | object | No | Metadatos a fusionar (establecer como null para eliminar una clave) |
| `addBlocks` | string[] | No | Lista de IDs de tareas bloqueadas por esta tarea |
| `addBlockedBy` | string[] | No | Lista de IDs de tareas previas que bloquean esta tarea |

## Flujo de estados

```
pending → in_progress → completed
```

`deleted` puede ser alcanzado desde cualquier estado, elimina permanentemente la tarea.

## Casos de uso

**Adecuado para:**
- Marcar una tarea como `in_progress` al comenzar a trabajar
- Marcar una tarea como `completed` al terminar el trabajo
- Establecer relaciones de dependencia entre tareas
- Actualizar el contenido de la tarea cuando cambian los requisitos

**Reglas importantes:**
- Solo marcar como `completed` cuando la tarea está completamente terminada
- Mantener como `in_progress` cuando se encuentran errores o bloqueos
- No marcar como `completed` cuando las pruebas fallan, la implementación es parcial o hay errores sin resolver

## Notas

- Antes de actualizar, se debe obtener el estado más reciente de la tarea mediante TaskGet para evitar datos obsoletos
- Después de completar una tarea, llamar a TaskList para encontrar la siguiente tarea disponible

## Significado en cc-viewer

TaskUpdate es una operación interna de gestión de tareas, no produce solicitudes API independientes.

## Texto original

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
