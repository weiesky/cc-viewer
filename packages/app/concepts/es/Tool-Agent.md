# Agent

Lanza un subagente autónomo de Claude Code con su propia ventana de contexto para realizar una tarea específica y devolver un único resultado consolidado. Este es el mecanismo canónico para delegar investigaciones abiertas, trabajo en paralelo o colaboración en equipo.

## Cuándo usar

- Búsquedas abiertas en las que aún no sabes qué archivos son relevantes y esperas varias rondas de `Glob`, `Grep` y `Read`.
- Trabajo independiente en paralelo — lanza varios agentes en un solo mensaje para investigar áreas distintas concurrentemente.
- Aislar exploración ruidosa de la conversación principal para mantener compacto el contexto del padre.
- Delegar a un tipo de subagente especializado como `Explore`, `Plan`, `claude-code-guide` o `statusline-setup`.
- Incorporar a un compañero de equipo con nombre a un equipo activo para trabajo coordinado multiagente.

NO uses esta herramienta cuando el archivo o símbolo objetivo ya sea conocido — usa `Read`, `Grep` o `Glob` directamente. Una búsqueda de un solo paso a través de `Agent` desperdicia una ventana de contexto completa y añade latencia.

## Parámetros

- `description` (string, obligatorio): Etiqueta breve de 3 a 5 palabras que describe la tarea; se muestra en la interfaz y en los registros.
- `prompt` (string, obligatorio): El encargo completo y autónomo que el agente ejecutará. Debe incluir todo el contexto, las restricciones y el formato de retorno esperado.
- `subagent_type` (string, opcional): Persona predefinida como `general-purpose`, `Explore`, `Plan`, `claude-code-guide` o `statusline-setup`. Por defecto es `general-purpose`.
- `run_in_background` (boolean, opcional): Si es `true`, el agente se ejecuta de forma asíncrona y el padre puede seguir trabajando; los resultados se recuperan más tarde.
- `model` (string, opcional): Anula el modelo para este agente — `opus`, `sonnet` o `haiku`. Por defecto se usa el modelo de la sesión padre.
- `isolation` (string, opcional): Establece a `worktree` para ejecutar el agente dentro de un worktree de git aislado, de modo que sus escrituras al sistema de archivos no colisionen con las del padre.
- `team_name` (string, opcional): Al incorporarse a un equipo existente, el identificador del equipo al que se unirá el agente.
- `name` (string, opcional): Nombre direccionable del compañero de equipo, usado como destino `to` para `SendMessage`.

## Ejemplos

### Ejemplo 1: Búsqueda de código abierta

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Ejemplo 2: Investigaciones independientes en paralelo

Lanza dos agentes en el mismo mensaje — uno inspeccionando el pipeline de compilación y otro revisando el framework de pruebas. Cada uno obtiene su propia ventana de contexto y devuelve un resumen. Agruparlos en un solo bloque de llamada de herramientas los ejecuta de forma concurrente.

### Ejemplo 3: Incorporar un compañero a un equipo activo

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Notas

- Los agentes no tienen memoria de ejecuciones previas. Cada invocación empieza desde cero, por lo que el `prompt` debe ser completamente autónomo — incluye rutas de archivos, convenciones, la pregunta y la forma exacta de la respuesta que quieres obtener.
- El agente devuelve exactamente un mensaje final. No puede hacer preguntas aclaratorias durante la ejecución, así que cualquier ambigüedad en el prompt se traduce en conjeturas en el resultado.
- Ejecutar varios agentes en paralelo es significativamente más rápido que llamadas secuenciales cuando las subtareas son independientes. Agrúpalos en un solo bloque de llamada de herramientas.
- Usa `isolation: "worktree"` siempre que un agente vaya a escribir archivos y quieras revisar los cambios antes de fusionar con el árbol de trabajo principal.
- Prefiere `subagent_type: "Explore"` para reconocimiento de solo lectura y `Plan` para trabajo de diseño; `general-purpose` es el valor por defecto para tareas mixtas de lectura/escritura.
- Los agentes en segundo plano (`run_in_background: true`) son adecuados para trabajos largos; evita sondear en bucles de `sleep` — se notifica al padre al completarse.
