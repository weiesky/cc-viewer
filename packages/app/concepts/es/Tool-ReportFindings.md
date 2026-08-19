# ReportFindings

Reporta hallazgos de revisión de código como una lista tipada y estructurada que la UI anfitriona renderiza de forma nativa — en lugar de imprimirlos como texto de chat.

## Cuándo usar

- Concluyendo una revisión de código cuyas instrucciones activas dicen explícitamente que reportes hallazgos con esta herramienta
- Re-reportar después de aplicar correcciones, cuando las instrucciones de revisión lo piden (cada hallazgo lleva entonces un `outcome`)
- **No** para opiniones ad hoc, respuestas ordinarias o revisiones cuyas instrucciones especifiquen un formato de salida diferente — y nunca junto con una copia de texto duplicada de los mismos hallazgos

## Parámetros

- `findings` (array, requerido, máx. 32): Los hallazgos verificados, clasificados por severidad primero — un array vacío si ningún hallazgo sobrevivió a la verificación. Cada hallazgo:
  - `file` (cadena, requerido): Ruta relativa al repositorio.
  - `line` (número, opcional): Número de línea de anclaje indexado en 1.
  - `summary` (cadena, requerido): Declaración del defecto en una sola oración.
  - `failure_scenario` (cadena, requerido): Entrada/estado concreto → salida incorrecta o fallo.
  - `category` (cadena, opcional): Slug corto en kebab-case, p. ej. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (cadena, opcional): `CONFIRMED` o `PLAUSIBLE` — se establece cuando una pasada de verificación se ejecutó; ausente en revisiones solo inline.
  - `outcome` (cadena, opcional): SOLO cuando re-reportas después de correcciones — `fixed`, `skipped` o `no_change_needed`.
- `level` (cadena, opcional): El nivel de esfuerzo en el que se ejecutó la revisión — `low`, `medium`, `high`, `xhigh` o `max`.

## Notas

- **Llámalo una vez.** Una sola llamada con la lista completa, verificada y ordenada por severidad — no una llamada por hallazgo.
- **Vacío es un resultado válido.** Si ningún hallazgo sobrevivió a la verificación, reporta un array vacío en lugar de rellenar con hallazgos débiles.
- **No duplicar en texto.** Cuando esta herramienta reporta los resultados, los hallazgos no deben imprimirse también como un mensaje de chat.
- **`outcome` es solo para re-reportes.** En el primer reporte déjalo sin establecer; después de una pasada de aplicación, establece lo que realmente le sucedió a cada hallazgo.
