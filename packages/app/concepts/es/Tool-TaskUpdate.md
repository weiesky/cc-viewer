# TaskUpdate

Modifica una tarea existente — su estado, contenido, propiedad, metadatos o aristas de dependencia. Así es como las tareas progresan a través de su ciclo de vida y cómo se traspasa trabajo entre Claude Code, compañeros y subagentes.

## Cuándo usar

- Transicionar una tarea a través del flujo de estados mientras trabajas en ella.
- Reclamar una tarea asignándote a ti mismo (u otro agente) como `owner`.
- Refinar el `subject` o `description` una vez que aprendes más sobre el problema.
- Registrar dependencias recién descubiertas con `addBlocks` / `addBlockedBy`.
- Adjuntar `metadata` estructurada como IDs de tickets externos o pistas de prioridad.

## Activación

- Disponible por defecto en la mayoría de los modelos.
- No disponible en las familias Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 y posteriores (v2.1.233+) salvo que se active explícitamente mediante `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- Todo el sistema de tareas se desactiva cuando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parámetros

- `taskId` (string, obligatorio): La tarea a modificar. Obtenlo de `TaskList` o `TaskCreate`.
- `status` (string, opcional): Uno de `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, opcional): Título imperativo de reemplazo.
- `description` (string, opcional): Descripción detallada de reemplazo.
- `activeForm` (string, opcional): Texto del indicador en presente continuo de reemplazo.
- `owner` (string, opcional): Handle del agente o compañero que asume la responsabilidad de la tarea.
- `metadata` (object, opcional): Claves de metadatos a fusionar con la tarea. Establece una clave a `null` para eliminarla.
- `addBlocks` (array de strings, opcional): IDs de tareas que esta tarea bloquea.
- `addBlockedBy` (array de strings, opcional): IDs de tareas que deben completarse antes que esta.

## Flujo de estados

El ciclo de vida es deliberadamente lineal: `pending` → `in_progress` → `completed`. `deleted` es terminal y se usa para retirar tareas que nunca se trabajarán.

- Establece `in_progress` en el momento en que realmente comienzas el trabajo, no antes. Solo una tarea a la vez debe estar `in_progress` para un propietario dado.
- Establece `completed` solo cuando el trabajo esté completamente hecho — criterios de aceptación cumplidos, pruebas pasando, salida escrita. Si aparece un bloqueante, mantén la tarea en `in_progress` y añade una nueva tarea que describa lo que debe resolverse.
- Nunca marques una tarea como `completed` cuando las pruebas están fallando, la implementación es parcial o te encuentras con errores sin resolver.
- Usa `deleted` para tareas que están canceladas o duplicadas; no reutilices una tarea para trabajo no relacionado.

## Ejemplos

### Ejemplo 1

Reclamar una tarea y comenzarla.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Ejemplo 2

Terminar el trabajo y registrar una dependencia de seguimiento.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Notas

- `metadata` fusiona clave por clave; pasar `null` para una clave la elimina. Llama primero a `TaskGet` si no estás seguro del contenido actual.
- `addBlocks` y `addBlockedBy` agregan aristas; no eliminan las existentes. Editar el grafo destructivamente requiere un flujo dedicado — consulta con el propietario del equipo antes de reescribir dependencias.
- Mantén `activeForm` sincronizado cuando cambies `subject` para que el texto del indicador siga leyéndose con naturalidad.
- No marques una tarea como `completed` para silenciarla. Si el usuario canceló el trabajo, usa `deleted` con una breve justificación en `description`.
- Lee el último estado de una tarea con `TaskGet` antes de actualizar — los compañeros pueden haberla cambiado entre tu última lectura y tu escritura.
