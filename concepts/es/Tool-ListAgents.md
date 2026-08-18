# ListAgents

Lista los agents a los que puedes `SendMessage`: sub-agents en proceso que lanzaste, otras sesiones locales de Claude en esta máquina, tus sesiones en la nube (cuando esta sesión tiene acceso a la nube) y — cuando Remote Control está conectado — las demás sesiones de tu cuenta. Cada fila está etiquetada por tipo.

## Cuándo usar

- Necesitas el nombre exacto de una sesión par o sub-agent antes de enviarle un mensaje.
- Quieres ver qué sesiones son alcanzables actualmente desde esta.

## Parámetros

- `channel` (string, opcional): No disponible en esta compilación; déjalo sin establecer.
- `q` (string, opcional): No disponible en esta compilación; déjalo sin establecer.

## Ejemplos

### Ejemplo 1: Listar agents alcanzables

```
ListAgents()
```

Cada fila imprime un nombre — ese nombre es la dirección. Envía con `SendMessage({to: "<name>", message: "..."})`, copiando el nombre exactamente como se imprime. Añade el ` [ref]` de una fila solo cuando el nombre a secas sea ambiguo (dos filas lo comparten, o un error te pide desambiguar).

## Notas

- Solo lectura y seguro para concurrencia.
- Una sesión en la nube recibe tu mensaje pero aún no puede responder — lee su respuesta en su propia transcripción.
- La disponibilidad depende de la configuración de la sesión (la mensajería entre sesiones es una función restringida).
