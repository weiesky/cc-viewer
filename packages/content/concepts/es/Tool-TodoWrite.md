# TodoWrite

Escribe una lista de tareas estructurada para la sesión actual, reemplazando la lista anterior. Cada elemento lleva su texto, un estado y una forma en presente continuo que se muestra en los indicadores de progreso.

## Cuándo usar

- Una tarea tiene varios pasos distintos y rastrearlos te ayuda a ti (y al usuario) a ver el progreso.
- El usuario pide explícitamente una lista de tareas.
- Quieres marcar exactamente un elemento como en progreso mientras el resto permanecen pendientes o completados.

## Activación

- Herramienta heredada: desactivada por defecto en sesiones que ofrecen las herramientas de tareas (`TaskCreate`, `TaskUpdate`, `TaskList`).
- Reactívala con `CLAUDE_CODE_ENABLE_TASKS=0`.

## Parámetros

- `todos` (array, obligatorio): La lista de tareas completa y actualizada. Cada entrada tiene:
  - `content` (string): La descripción de la tarea.
  - `status` (string): Uno de `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Texto en presente continuo mostrado mientras el elemento está en progreso (p. ej. "Running tests").

## Ejemplos

### Ejemplo 1: Rastrear un cambio de tres pasos

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

La lista completa se reescribe en cada llamada — incluye siempre todos los elementos, no solo los que cambiaron.

## Notas

- La lista se reemplaza por completo en cada llamada; para actualizar un elemento, vuelve a enviar todos los elementos con el nuevo estado.
- Mantén exactamente un elemento `in_progress` a la vez.
- En sesiones donde las herramientas de tareas estructuradas (`TaskCreate`/`TaskUpdate`/`TaskList`) están habilitadas, el harness puede ofrecer esas en lugar de `TodoWrite` — prefiere el conjunto de herramientas que esté anunciado.
