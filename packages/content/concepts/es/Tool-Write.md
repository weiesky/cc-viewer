# Write

Crea un archivo nuevo o reemplaza completamente el contenido de uno existente en el sistema de archivos local. Como reemplaza todo en la ruta objetivo, debe reservarse para creación genuina o reescrituras completas intencionadas.

## Cuándo usar

- Crear un archivo fuente, prueba o configuración nuevos que aún no existen
- Generar un fixture, snapshot o archivo de datos nuevo desde cero
- Realizar una reescritura completa donde un `Edit` incremental sería más complejo que empezar de nuevo
- Emitir un artefacto solicitado como un esquema, migración o script de compilación que el usuario pidió explícitamente producir

## Parámetros

- `file_path` (string, obligatorio): Ruta absoluta del archivo a escribir. Los directorios padre deben existir ya.
- `content` (string, obligatorio): El texto completo a escribir en el archivo. Este se convierte en el cuerpo completo del archivo.

## Ejemplos

### Ejemplo 1: Crear un módulo helper nuevo
Llama a `Write` con `file_path: "/Users/me/app/src/utils/slugify.ts"` y proporciona la implementación como `content`. Usa esto solo después de verificar que el archivo no existe ya.

### Ejemplo 2: Regenerar un artefacto derivado
Tras cambiar la fuente del esquema, reescribe `/Users/me/app/generated/schema.json` en una sola llamada `Write` usando el JSON recién generado como `content`.

### Ejemplo 3: Reemplazar un archivo de fixture pequeño
Para un fixture de prueba desechable donde cada línea cambia, `Write` puede ser más claro que una secuencia de llamadas `Edit`. Lee el archivo primero, confirma el ámbito y luego sobrescribe.

## Notas

- Antes de sobrescribir un archivo existente, debes llamar a `Read` sobre él en la sesión actual. `Write` se niega a aplastar contenido no visto.
- Prefiere `Edit` para cualquier cambio que toque solo parte de un archivo. `Edit` envía solo el diff, lo cual es más rápido, más seguro y más fácil de revisar.
- No crees proactivamente documentación Markdown, archivos `README.md` o changelogs a menos que el usuario los solicite explícitamente.
- No añadas emojis, texto de marketing o banners decorativos a menos que el usuario pida ese estilo.
- Verifica primero que el directorio padre existe con una llamada `ls` con `Bash`; `Write` no crea carpetas intermedias.
- Proporciona el contenido exactamente como quieres que se persista; no hay plantillas ni postprocesado.
