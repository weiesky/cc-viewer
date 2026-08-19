# Skill

Invoca una skill con nombre dentro de la conversación actual. Las skills son paquetes preconfigurados de capacidades — conocimiento de dominio, flujos de trabajo y a veces acceso a herramientas — que el harness expone al asistente a través de recordatorios del sistema.

## Cuándo usar

- El usuario escribe un comando de barra como `/review` o `/init` — los comandos de barra son skills y deben ejecutarse a través de esta herramienta.
- El usuario describe una tarea que coincide con las condiciones de activación de una skill anunciada (por ejemplo, pedir escanear transcripciones en busca de solicitudes de permiso repetidas coincide con `fewer-permission-prompts`).
- El propósito declarado de una skill es una coincidencia directa con el archivo, solicitud o contexto de conversación actual.
- Hay flujos de trabajo especializados y repetibles disponibles como skills y el procedimiento canónico es preferible a un enfoque ad-hoc.
- El usuario pregunta "¿qué skills hay disponibles?" — lista los nombres anunciados e invoca solo cuando lo confirmen.

## Parámetros

- `skill` (string, obligatorio): El nombre exacto de una skill listada en el recordatorio del sistema de skills disponibles actual. Para skills con namespace de plugin, usa el formato totalmente cualificado `plugin:skill` (por ejemplo `skill-creator:skill-creator`). No incluyas una barra inicial.
- `args` (string, opcional): Argumentos de formato libre pasados a la skill. El formato y la semántica están definidos por la documentación propia de cada skill.

## Ejemplos

### Ejemplo 1: Ejecutar una skill de revisión en la rama actual

```
Skill(skill="review")
```

La skill `review` empaqueta los pasos para revisar un pull request contra la rama base actual. Invocarla carga el procedimiento de revisión definido por el harness en el turno.

### Ejemplo 2: Invocar una skill con namespace de plugin con argumentos

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Enruta la solicitud a través del punto de entrada del plugin `skill-creator` para que se active el flujo de autoría.

## Notas

- Solo invoca skills cuyos nombres aparezcan literalmente en el recordatorio del sistema de skills disponibles, o skills que el usuario haya escrito directamente como `/nombre` en su mensaje. Nunca adivines ni inventes nombres de skills a partir de la memoria o datos de entrenamiento — si la skill no está anunciada, no llames a esta herramienta.
- Cuando la solicitud del usuario coincide con una skill anunciada, llamar a `Skill` es un prerrequisito bloqueante: invócala antes de generar cualquier otra respuesta sobre la tarea. No describas lo que haría la skill — ejecútala.
- Nunca menciones una skill por su nombre sin invocarla realmente. Anunciar una skill sin llamar a la herramienta es engañoso.
- No uses `Skill` para comandos integrados del CLI como `/help`, `/clear`, `/model` o `/exit`. Esos los maneja el harness directamente.
- No vuelvas a invocar una skill que ya esté ejecutándose en el turno actual. Si ves una etiqueta `<command-name>` en el turno actual, la skill ya ha sido cargada — sigue sus instrucciones directamente en lugar de volver a llamar a la herramienta.
- Si varias skills pudieran aplicar, elige la más específica. Para cambios de configuración como añadir permisos o hooks, prefiere `update-config` sobre un enfoque genérico de configuración.
- La ejecución de una skill puede introducir nuevos recordatorios del sistema, herramientas o restricciones para el resto del turno. Vuelve a leer el estado de la conversación después de que una skill se complete antes de proceder.
