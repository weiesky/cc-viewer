# TaskList

## Definición

Lista todas las tareas en la lista de tareas para ver el progreso general y el trabajo disponible.

## Parámetros

Sin parámetros.

## Contenido devuelto

Información resumida de cada tarea:
- `id` — Identificador de la tarea
- `subject` — Descripción breve
- `status` — Estado: `pending`, `in_progress` o `completed`
- `owner` — Responsable (agent ID), vacío indica no asignado
- `blockedBy` — Lista de IDs de tareas incompletas que bloquean esta tarea

## Casos de uso

**Adecuado para:**
- Ver qué tareas están disponibles (estado pending, sin owner, no bloqueadas)
- Verificar el progreso general del proyecto
- Encontrar tareas bloqueadas
- Buscar la siguiente tarea después de completar una

## Notas

- Preferir procesar tareas en orden de ID (ID más bajo primero), ya que las tareas anteriores generalmente proporcionan contexto para las posteriores
- Las tareas con `blockedBy` no pueden ser reclamadas hasta que se resuelvan las dependencias
- Usar TaskGet para obtener los detalles completos de una tarea específica

## Significado en cc-viewer

TaskList es una operación interna de gestión de tareas, no produce solicitudes API independientes.

## Texto original

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
