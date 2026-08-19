# TaskList

Devuelve cada tarea del equipo (o sesión) actual en forma resumida. Úsala para revisar el trabajo pendiente, decidir qué tomar a continuación y evitar crear duplicados.

## Cuándo usar

- Al inicio de una sesión para ver qué ya está registrado.
- Antes de llamar a `TaskCreate`, para confirmar que el trabajo no esté ya capturado.
- Al decidir qué tarea reclamar a continuación como compañero o subagente.
- Para verificar relaciones de dependencia a lo largo del equipo de un vistazo.
- Periódicamente durante sesiones largas para resincronizar con compañeros que pueden haber reclamado, completado o añadido tareas.

`TaskList` es de solo lectura y económico; llámalo libremente cuando necesites una visión general.

## Activación

- Disponible por defecto en la mayoría de los modelos.
- No disponible en las familias Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 y posteriores (v2.1.233+) salvo que se active explícitamente mediante `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- Todo el sistema de tareas se desactiva cuando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parámetros

`TaskList` no recibe parámetros. Siempre devuelve el conjunto completo de tareas del contexto activo.

## Forma de la respuesta

Cada tarea en la lista es un resumen, no el registro completo. Espera aproximadamente:

- `id` — identificador estable para usar con `TaskGet` / `TaskUpdate`.
- `subject` — título corto en imperativo.
- `status` — uno de `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — handle de agente o compañero, o vacío cuando no está reclamada.
- `blockedBy` — array de IDs de tarea que deben completarse primero.

Para la descripción completa, los criterios de aceptación o los metadatos de una tarea específica, sigue con `TaskGet`.

## Ejemplos

### Ejemplo 1

Comprobación rápida de estado.

```
TaskList()
```

Escanea la salida en busca de cualquier cosa `in_progress` sin `owner` (trabajo obsoleto) y cualquier cosa `pending` con `blockedBy` vacío (lista para tomar).

### Ejemplo 2

Compañero eligiendo la siguiente tarea.

```
TaskList()
# Filtra a: status == pending Y blockedBy vacío Y owner vacío.
# Entre esas, prefiere el ID más bajo (las tareas se numeran
# típicamente en orden de creación, así que los IDs más bajos
# son más antiguos y usualmente de mayor prioridad).
TaskGet(taskId: "<id elegido>")
TaskUpdate(taskId: "<id elegido>", status: "in_progress", owner: "<tu handle>")
```

## Notas

- Heurística de compañero: cuando varias tareas `pending` están desbloqueadas y sin propietario, elige el ID más bajo. Esto mantiene el trabajo FIFO y evita que dos agentes agarren la misma tarea de alto perfil.
- Respeta `blockedBy`: no inicies una tarea cuyas bloqueantes sigan `pending` o `in_progress`. Trabaja primero en la bloqueante o coordina con su propietario.
- `TaskList` es el único mecanismo de descubrimiento para tareas. No hay búsqueda; si la lista es larga, escanéala estructuralmente (por estado, luego por propietario).
- Las tareas eliminadas pueden seguir apareciendo en la lista con estado `deleted` para trazabilidad. Ignóralas para efectos de planificación.
- La lista refleja el estado vivo del equipo, por lo que los compañeros pueden añadir o reclamar tareas entre llamadas. Vuelve a listar antes de reclamar si ha pasado tiempo.
