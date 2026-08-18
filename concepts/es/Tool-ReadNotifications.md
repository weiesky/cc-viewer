# ReadNotifications

Lee las notificaciones encoladas para el asistente en la sesión actual — actividad de GitHub en PRs suscritos (`github_webhook`), disparos de triggers programados (`trigger_fire`) y mensajes que llegan de otras sesiones de Claude (`mcp_send_message`).

## Cuándo usar

- Te notificaron que algo ocurrió — un PR suscrito se actualizó, un trigger programado se disparó, otra sesión te envió un mensaje — y necesitas el payload real.
- Vaciar un backlog: los lotes grandes se devuelven en partes, así que sigue llamando hasta que el resultado reporte 0 `remaining`.

## Parámetros

Esta herramienta no toma parámetros.

## Ejemplos

### Ejemplo 1: Vaciar notificaciones pendientes

```
ReadNotifications()
```

Devuelve las notificaciones encoladas, las más antiguas primero. El resultado incluye un contador `remaining` de notificaciones aún encoladas después de este vaciado — vuelve a llamar a la herramienta para leerlas.

## Notas

- Los vaciados tienen un presupuesto de tamaño: una llamada de seguimiento devuelve el resto de la MISMA cola (más lo que haya llegado nuevo), no solo las nuevas llegadas. Itera hasta que `remaining` sea 0.
- Las notificaciones se originan en webhooks de GitHub sobre PRs suscritos, triggers programados y mensajes de otras sesiones de Claude; no hay parámetro de filtrado en la versión actual.
