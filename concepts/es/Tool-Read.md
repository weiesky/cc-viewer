# Read

## Definición

Lee el contenido de archivos del sistema de archivos local. Soporta archivos de texto, imágenes, PDF y Jupyter notebook.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `file_path` | string | Sí | Ruta absoluta del archivo |
| `offset` | number | No | Número de línea inicial (para lectura segmentada de archivos grandes) |
| `limit` | number | No | Número de líneas a leer (para lectura segmentada de archivos grandes) |
| `pages` | string | No | Rango de páginas PDF (como "1-5", "3", "10-20"), solo aplicable a PDF |

## Casos de uso

**Adecuado para:**
- Leer archivos de código, archivos de configuración y otros archivos de texto
- Ver archivos de imagen (Claude es un modelo multimodal)
- Leer documentos PDF
- Leer Jupyter notebooks (devuelve todas las celdas y salidas)
- Leer múltiples archivos en paralelo para obtener contexto

**No adecuado para:**
- Leer directorios — usar el comando `ls` de Bash
- Exploración abierta de la base de código — usar Task (tipo Explore)

## Notas

- La ruta debe ser absoluta, no relativa
- Por defecto lee las primeras 2000 líneas del archivo
- Las líneas que excedan 2000 caracteres serán truncadas
- La salida usa formato `cat -n`, los números de línea comienzan en 1
- Los PDF grandes (más de 10 páginas) deben especificar el parámetro `pages`, máximo 20 páginas por vez
- Leer un archivo inexistente devuelve un error (no se bloquea)
- Se pueden hacer múltiples llamadas Read en paralelo en un solo mensaje

## Significado en cc-viewer

Las llamadas a Read aparecen en el registro de solicitudes como pares de content blocks `tool_use` (llamada) y `tool_result` (contenido devuelto). El `tool_result` contiene el contenido real del archivo, lo que permite analizar qué archivos leyó el modelo.

## Texto original

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
