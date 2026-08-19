# SendFeedback

Envía feedback estructurado sobre Claude Code a Anthropic — reportes de errores, ideas de funcionalidades o capacidades faltantes — sin salir de la sesión.

## Cuándo usar

- El usuario pide reportar un bug o enviar feedback sobre Claude Code en sí.
- Encuentras un defecto claro del producto (comando roto, comportamiento incorrecto, crash) que merece ser reportado.
- El usuario describe una funcionalidad que le gustaría que existiera (una idea o capacidad faltante).

## Parámetros

- `type` (string, obligatorio): Uno de `bug`, `idea`, `missing_capability`.
- `title` (string, obligatorio): Resumen corto y específico del problema en una sola línea.
- `details` (string, obligatorio): Viñetas etiquetadas, en orden: **What happened:** (observado vs. esperado, texto exacto del error si es corto); **What the user said:** (citado, o "User didn't comment; observed by the model."); **Repro:** (pasos mínimos); **Evidence:** (request IDs, timestamps, rutas, versiones — omítelo si no hay); opcionalmente un **Cause:** final solo si se verificó en la sesión. De una a tres líneas por viñeta; sin párrafos narrativos, sin especulación, sin secretos.
- `area` (string, opcional): Etiqueta corta que nombra la parte de Claude Code de la que trata (p. ej. "hooks config", "/help", "file editing"). Déjalo en blanco si no está claro.
- `failure_mode` (string, opcional): Para reportes de comportamiento del modelo, el modo de fallo más cercano (p. ej. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short`, o `other`). Omítelo solo cuando el reporte es un bug puro de producto/herramienta.
- `task_category` (string, opcional): Qué estaba haciendo la sesión cuando ocurrió el problema: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review`, o `other`.

## Ejemplos

### Ejemplo 1: Reportar un bug del producto

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Notas

- Nunca incluyas secretos, tokens o datos privados del usuario en `details`.
- Cita las palabras del usuario cuando estén disponibles; de lo contrario, indica que el modelo observó el problema.
- Mantén el reporte factual — la especulación sobre la causa raíz va en `**Cause:**` solo cuando se verificó en la sesión.
