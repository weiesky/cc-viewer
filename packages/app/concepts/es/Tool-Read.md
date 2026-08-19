# Read

Carga el contenido de un solo archivo del sistema de archivos local. Soporta texto plano, código fuente, imágenes, PDFs y notebooks de Jupyter, devolviendo resultados con números de línea basados en 1 al estilo `cat -n`.

## Cuándo usar

- Leer un archivo fuente en una ruta conocida antes de editar o analizar
- Inspeccionar archivos de configuración, lockfiles, registros o artefactos generados
- Ver capturas de pantalla o diagramas que el usuario pegó en la conversación
- Extraer un rango específico de páginas de un manual PDF largo
- Abrir un notebook `.ipynb` para revisar celdas de código, markdown y salidas de celdas juntas

## Parámetros

- `file_path` (string, obligatorio): Ruta absoluta al archivo objetivo. Las rutas relativas son rechazadas.
- `offset` (integer, opcional): Número de línea basado en 1 desde el que empezar a leer. Útil para archivos grandes cuando se combina con `limit`.
- `limit` (integer, opcional): Máximo número de líneas a devolver empezando en `offset`. Por defecto 2000 líneas desde la parte superior del archivo cuando se omite.
- `pages` (string, opcional): Rango de páginas para archivos PDF, por ejemplo `"1-5"`, `"3"` o `"10-20"`. Obligatorio para PDFs de más de 10 páginas; máximo 20 páginas por solicitud.

## Ejemplos

### Ejemplo 1: Leer un archivo pequeño completo
Llama a `Read` solo con `file_path` establecido a `/Users/me/project/src/index.ts`. Se devuelven hasta 2000 líneas con números de línea, lo que suele ser suficiente para el contexto de edición.

### Ejemplo 2: Paginar un registro largo
Usa `offset: 5001` y `limit: 500` en un archivo de registro de varios miles de líneas para recuperar una ventana estrecha sin desperdiciar tokens de contexto.

### Ejemplo 3: Extraer páginas específicas de PDF
Para un PDF de 120 páginas en `/tmp/spec.pdf`, establece `pages: "8-15"` para extraer solo el capítulo que necesitas. Omitir `pages` en un PDF grande produce un error.

### Ejemplo 4: Ver una imagen
Pasa la ruta absoluta de una captura de pantalla PNG o JPG. La imagen se renderiza visualmente para que Claude Code pueda razonar directamente sobre ella.

## Notas

- Siempre prefiere rutas absolutas. Si el usuario proporciona una, confía en ella tal como está.
- Las líneas de más de 2000 caracteres se truncan; trata el contenido devuelto como posiblemente recortado para datos extremadamente anchos.
- ¿Leyendo varios archivos independientes? Emite varias llamadas `Read` en la misma respuesta para que se ejecuten en paralelo.
- `Read` no puede listar directorios. Usa una llamada `ls` con `Bash` o la herramienta `Glob` en su lugar.
- Leer un archivo existente pero vacío devuelve un recordatorio del sistema en lugar de los bytes del archivo, así que maneja esa señal explícitamente.
- Un `Read` exitoso es requerido antes de poder usar `Edit` en el mismo archivo en la sesión actual.
