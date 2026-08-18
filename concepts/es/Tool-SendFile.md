# SendFile

Envía uno o más archivos a otra sesión de Claude Code — una par listada por `ListAgents`, o una dirección de sesión explícita.

## Cuándo usar

- Una sesión par necesita un archivo de tu directorio de trabajo (un informe, un parche, un fixture) para continuar su propia tarea.
- Estás coordinando trabajo entre sesiones y quieres entregar artefactos, no solo texto (usa `SendMessage` para texto).

## Parámetros

- `to` (string, obligatorio): Destinatario — un nombre de sesión par de `ListAgents`, o una dirección explícita `uds:<socket>` / `bridge:<session id>`.
- `files` (array de strings, obligatorio): Rutas de archivos (absolutas o relativas al directorio de trabajo actual) a enviar. Pasa siempre un array, incluso para un solo archivo. De 1 a 16 archivos, como máximo 30 MiB cada uno.
- `message` (string, opcional): Mensaje corto entregado junto con los archivos.

## Ejemplos

### Ejemplo 1: Enviar un informe a una sesión par

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Notas

- La transferencia de archivos entre sesiones debe estar disponible en la sesión; cuando no lo está, la validación falla con "Cross-session file transfer is not available in this session."
- Las transferencias a máquinas remotas pueden requerir aprobación adicional.
- Leer el contenido de los archivos es parte del envío — se deniega si las lecturas de archivos están deshabilitadas por reglas de permisos.
