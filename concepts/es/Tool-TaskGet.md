# TaskGet

## Definición

Obtiene los detalles completos de una tarea mediante su ID.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `taskId` | string | Sí | ID de la tarea a obtener |

## Contenido devuelto

- `subject` — Título de la tarea
- `description` — Requisitos detallados y contexto
- `status` — Estado: `pending`, `in_progress` o `completed`
- `blocks` — Lista de tareas bloqueadas por esta tarea
- `blockedBy` — Lista de tareas previas que bloquean esta tarea

## Casos de uso

**Adecuado para:**
- Obtener la descripción completa y el contexto de una tarea antes de comenzar a trabajar
- Entender las relaciones de dependencia de una tarea
- Obtener los requisitos completos después de ser asignado a una tarea

## Notas

- Después de obtener la tarea, se debe verificar si la lista `blockedBy` está vacía antes de comenzar a trabajar
- Usar TaskList para ver la información resumida de todas las tareas

## Significado en cc-viewer

TaskGet es una operación interna de gestión de tareas, no produce solicitudes API independientes.

## Texto original

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
