# CronDelete

Cancela un trabajo cron previamente programado con `CronCreate`. Lo elimina inmediatamente del almacén de sesión en memoria. No tiene efecto si el trabajo ya fue eliminado automáticamente (los trabajos de una sola ejecución se eliminan tras dispararse, los trabajos recurrentes expiran tras 7 días).

## Cuándo usar

- Un usuario solicita detener una tarea programada recurrente antes de su expiración automática de 7 días.
- Un trabajo de una sola ejecución ya no es necesario y debe cancelarse antes de que se dispare.
- Se necesita cambiar la expresión de programación de un trabajo existente — eliminarlo con `CronDelete` y luego volver a crearlo con `CronCreate` usando la nueva expresión.
- Limpiar varios trabajos obsoletos para mantener el almacén de sesión ordenado.

## Parámetros

- `id` (string, requerido): El ID de trabajo devuelto por `CronCreate` cuando el trabajo fue creado por primera vez. Este valor debe coincidir exactamente; no se admite búsqueda difusa ni por nombre.

## Ejemplos

### Ejemplo 1: cancelar un trabajo recurrente en ejecución

Un trabajo recurrente fue creado anteriormente con el ID `"cron_abc123"`. El usuario solicita detenerlo.

```
CronDelete({ id: "cron_abc123" })
```

El trabajo se elimina del almacén de sesión y no se volverá a ejecutar.

### Ejemplo 2: eliminar un trabajo de una sola ejecución obsoleto antes de que se dispare

Un trabajo de una sola ejecución con el ID `"cron_xyz789"` fue programado para ejecutarse en 30 minutos, pero el usuario ha decidido que ya no es necesario.

```
CronDelete({ id: "cron_xyz789" })
```

El trabajo se cancela. No se realizará ninguna acción cuando llegue el momento de disparo original.

## Notas

- El `id` debe obtenerse del valor de retorno de `CronCreate`. No hay forma de buscar un trabajo por descripción o callback — guarde el ID si puede necesitar cancelarlo más adelante.
- Si el trabajo ya fue eliminado automáticamente (se disparó como trabajo de una sola ejecución, o alcanzó la expiración recurrente de 7 días), llamar a `CronDelete` con ese ID es una operación sin efecto y no producirá un error.
- `CronDelete` solo afecta la sesión en memoria actual. Si el entorno de ejecución no persiste el estado cron entre reinicios, los trabajos programados se perderán al reiniciar independientemente de si se llamó a `CronDelete`.
- No existe operación de eliminación masiva; cancele cada trabajo individualmente usando su propio `id`.
