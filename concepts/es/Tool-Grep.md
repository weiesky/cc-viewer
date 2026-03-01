# Grep

## Definición

Potente herramienta de búsqueda de contenido basada en ripgrep. Soporta expresiones regulares, filtrado por tipo de archivo y múltiples modos de salida.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `pattern` | string | Sí | Patrón de búsqueda con expresión regular |
| `path` | string | No | Ruta de búsqueda (archivo o directorio), por defecto el directorio de trabajo actual |
| `glob` | string | No | Filtro de nombre de archivo (como `*.js`, `*.{ts,tsx}`) |
| `type` | string | No | Filtro de tipo de archivo (como `js`, `py`, `rust`), más eficiente que glob |
| `output_mode` | enum | No | Modo de salida: `files_with_matches` (por defecto), `content`, `count` |
| `-i` | boolean | No | Búsqueda insensible a mayúsculas/minúsculas |
| `-n` | boolean | No | Mostrar números de línea (solo modo content), por defecto true |
| `-A` | number | No | Número de líneas a mostrar después de la coincidencia |
| `-B` | number | No | Número de líneas a mostrar antes de la coincidencia |
| `-C` / `context` | number | No | Número de líneas a mostrar antes y después de la coincidencia |
| `head_limit` | number | No | Limitar el número de entradas de salida, por defecto 0 (ilimitado) |
| `offset` | number | No | Omitir los primeros N resultados |
| `multiline` | boolean | No | Habilitar modo de coincidencia multilínea, por defecto false |

## Casos de uso

**Adecuado para:**
- Buscar cadenas o patrones específicos en la base de código
- Encontrar ubicaciones de uso de funciones/variables
- Filtrar resultados de búsqueda por tipo de archivo
- Contar el número de coincidencias

**No adecuado para:**
- Buscar archivos por nombre — usar Glob
- Exploración abierta que requiere múltiples rondas de búsqueda — usar Task (tipo Explore)

## Notas

- Usa sintaxis ripgrep (no grep), los caracteres especiales como llaves necesitan escape
- El modo `files_with_matches` solo devuelve rutas de archivos, es el más eficiente
- El modo `content` devuelve el contenido de las líneas coincidentes, soporta líneas de contexto
- La coincidencia multilínea requiere establecer `multiline: true`
- Siempre preferir usar la herramienta Grep en lugar de los comandos `grep` o `rg` en Bash

## Significado en cc-viewer

Las llamadas a Grep aparecen en el registro de solicitudes como pares de content blocks `tool_use` / `tool_result`. El `tool_result` contiene los resultados de búsqueda.

## Texto original

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
