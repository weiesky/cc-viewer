# TaskGet

Recupera el registro completo de una sola tarea por ID, incluyendo su descripción, estado actual, propietario, metadatos y aristas de dependencia. Úsala cuando el resumen devuelto por `TaskList` no sea suficiente para actuar sobre la tarea.

## Cuándo usar

- Tomaste una tarea de `TaskList` y necesitas la descripción completa antes de empezar a trabajar.
- Estás a punto de marcar una tarea como `completed` y quieres revisar de nuevo los criterios de aceptación.
- Necesitas inspeccionar qué tareas bloquea esta (`blocks`) o qué tareas la bloquean (`blockedBy`) para decidir el siguiente movimiento.
- Estás investigando el historial — quién la tiene asignada, qué metadatos se adjuntaron, cuándo cambió de estado.
- Un compañero o una sesión anterior referenció un ID de tarea y necesitas el contexto.

Prefiere `TaskList` cuando solo necesites una vista de alto nivel; reserva `TaskGet` para el registro específico que pretendes leer cuidadosamente o modificar.

## Activación

- Disponible por defecto en la mayoría de los modelos.
- No disponible en las familias Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 y posteriores (v2.1.233+) salvo que se active explícitamente mediante `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- Todo el sistema de tareas se desactiva cuando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parámetros

- `taskId` (string, obligatorio): El identificador de la tarea devuelto por `TaskCreate` o `TaskList`. Los IDs son estables durante toda la vida de la tarea.

## Ejemplos

### Ejemplo 1

Busca una tarea que acabas de ver en la lista.

```
TaskGet(taskId: "t_01HXYZ...")
```

Campos típicos de la respuesta: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Ejemplo 2

Resolver dependencias antes de empezar.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspecciona blockedBy — si alguna tarea referenciada sigue pendiente
# o en curso, trabaja primero en la bloqueante.
```

## Notas

- `TaskGet` es de solo lectura y seguro de llamar repetidamente; no cambia estado ni propiedad.
- Si `blockedBy` no está vacío y contiene tareas que no están `completed`, no empieces esta tarea — resuelve primero las bloqueantes (o coordina con su propietario).
- El campo `description` puede ser largo. Léelo completo antes de actuar; hojearlo lleva a pasar por alto criterios de aceptación.
- Un `taskId` desconocido o eliminado devuelve un error. Vuelve a ejecutar `TaskList` para obtener un ID actual.
- Si estás a punto de editar una tarea, llama a `TaskGet` primero para evitar sobrescribir campos que un compañero acaba de cambiar.
