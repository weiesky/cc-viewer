# SendUserMessage

Envía un mensaje al usuario — el canal de salida visible principal en sesiones estilo brief. También conocido por su alias heredado `Brief`.

## Cuándo usar

- Responder a algo que el usuario acaba de decir (`status="normal"`).
- Hacer visible de forma proactiva algo que el usuario no ha pedido y necesita ver ahora — una tarea que se completa mientras no está, un bloqueo con el que te topaste, una actualización de estado no solicitada (`status="proactive"`).

## Parámetros

En modo brief:

- `message` (string, obligatorio): El mensaje para el usuario. Admite formato markdown.
- `attachments` (array, opcional): Adjuntos mostrados junto al mensaje. Cada entrada es una ruta de archivo (absoluta o relativa al directorio de trabajo actual) para un archivo legible localmente, o un objeto pre-resuelto `{file_uuid, file_name, size, is_image}` obtenido de una herramienta de dispositivo como `attach_file`.
- `status` (string, obligatorio): `proactive` para actualizaciones no solicitadas que el usuario necesita ahora; `normal` al responder al usuario.

En compilaciones sin modo brief solo está disponible `message`.

## Ejemplos

### Ejemplo 1: Aviso de finalización proactivo

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Notas

- Solo habilitado en modo brief o mediante el lanzamiento de la función correspondiente; la mayoría de las sesiones CLI interactivas hablan directamente con el usuario en su lugar.
- Usa `proactive` con moderación — está pensado para cosas que genuinamente necesitan la atención del usuario ahora.
