# TaskOutput

Recupera la salida acumulada de una tarea en segundo plano en ejecución o completada — un comando de shell en segundo plano, un agente local o una sesión remota. Úsala cuando necesites inspeccionar lo que una tarea de larga duración ha producido hasta ahora.

## Cuándo usar

- Una sesión remota (por ejemplo un sandbox en la nube) está ejecutándose y necesitas su stdout.
- Un agente local fue despachado en segundo plano y quieres el progreso parcial antes de que retorne.
- Un comando de shell en segundo plano lleva el tiempo suficiente ejecutándose como para que quieras verificarlo sin detenerlo.
- Necesitas confirmar que una tarea en segundo plano realmente está progresando antes de esperar más o llamar a `TaskStop`.

No recurras a `TaskOutput` reflexivamente. Para la mayoría del trabajo en segundo plano hay un camino más directo — ver las notas a continuación.

## Parámetros

- `task_id` (string, obligatorio): El identificador de tarea devuelto cuando se inició el trabajo en segundo plano. No es lo mismo que un `taskId` de la lista de tareas; este es el handle en tiempo de ejecución para la ejecución específica.
- `block` (boolean, opcional): Cuando es `true` (por defecto), espera hasta que la tarea produzca nueva salida o termine antes de retornar. Cuando es `false`, retorna inmediatamente con lo que esté en el buffer.
- `timeout` (number, opcional): Milisegundos máximos a bloquear antes de retornar. Solo significativo cuando `block` es `true`. Por defecto `30000`, máximo `600000`.

## Ejemplos

### Ejemplo 1

Echar un vistazo a una sesión remota sin bloquear.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Devuelve cualquier stdout/stderr que se haya producido desde que la tarea comenzó (o desde tu última llamada `TaskOutput`, dependiendo del runtime).

### Ejemplo 2

Esperar brevemente a que un agente local emita más salida.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Notas

- Comandos bash en segundo plano: `TaskOutput` está efectivamente deprecado para este caso de uso. Cuando inicias una tarea de shell en segundo plano el resultado ya incluye la ruta a su archivo de salida — lee esa ruta directamente con la herramienta `Read`. `Read` te da acceso aleatorio, offsets de línea y una vista estable; `TaskOutput` no.
- Agentes locales (la herramienta `Agent` despachada en segundo plano): cuando el agente termina, el resultado de la herramienta `Agent` ya contiene su respuesta final. Úsalo directamente. No hagas `Read` del archivo de transcripción simbólico — contiene el stream completo de llamadas de herramientas y desbordará la ventana de contexto.
- Sesiones remotas: `TaskOutput` es la forma correcta y a menudo la única de transmitir la salida de vuelta. Prefiere `block: true` con un `timeout` modesto sobre bucles de sondeo apretados.
- Un `task_id` desconocido, o una tarea cuya salida ha sido recolectada por el garbage collector, devuelve un error. Re-despacha el trabajo si aún lo necesitas.
- `TaskOutput` no detiene la tarea. Usa `TaskStop` para terminarla.
