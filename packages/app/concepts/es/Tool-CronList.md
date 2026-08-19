# CronList

Lista todos los trabajos cron programados mediante `CronCreate` en la sesión actual. Devuelve un resumen de cada cron activo que incluye `id`, expresión cron, `prompt` abreviado, indicador `recurring`, indicador `durable` y la próxima hora de ejecución.

## Cuándo usar

- Para auditar todos los trabajos actualmente programados antes de realizar cambios o finalizar una sesión.
- Para encontrar el `id` correcto de un trabajo antes de llamar a `CronDelete` y eliminarlo.
- Para depurar por qué un trabajo esperado nunca se ejecutó, confirmando su existencia y revisando su próxima hora de ejecución.
- Para confirmar que un trabajo de una sola ejecución (no recurrente) aún no se ha disparado y sigue pendiente.

## Parámetros

Ninguno.

## Ejemplos

### Ejemplo 1: auditar todos los trabajos programados

Invocar `CronList` sin argumentos para obtener la lista completa de todos los trabajos cron activos. La respuesta incluye el `id` de cada trabajo, la expresión cron que define su horario, una versión truncada del `prompt` que ejecutará, si es `recurring` (recurrente), si es `durable` (persistente entre reinicios) y la próxima hora en que está programado para ejecutarse.

### Ejemplo 2: localizar el id de una tarea recurrente específica

Si se crearon varios trabajos cron y es necesario eliminar uno en particular, invocar primero `CronList`. Examinar la lista devuelta en busca del trabajo cuyo resumen de `prompt` y expresión cron coincidan con la tarea que se desea eliminar. Copiar su `id` y pasarlo a `CronDelete`.

## Notas

- Solo se listan los trabajos creados en la sesión actual, a menos que hayan sido creados con `durable: true`, lo que les permite persistir tras reinicios de sesión.
- El campo `prompt` en el resumen está truncado; muestra solo el comienzo del texto completo del prompt, no el contenido íntegro.
- Los trabajos de una sola ejecución (`recurring` es `false`) que ya se han disparado son eliminados automáticamente y ya no aparecen en la lista.
