# Glob

## Definición

Herramienta rápida de coincidencia de patrones de nombres de archivo, compatible con bases de código de cualquier tamaño. Devuelve rutas de archivos coincidentes ordenadas por tiempo de modificación.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `pattern` | string | Sí | Patrón glob (como `**/*.js`, `src/**/*.ts`) |
| `path` | string | No | Directorio de búsqueda, por defecto el directorio de trabajo actual. No pasar "undefined" ni "null" |

## Casos de uso

**Adecuado para:**
- Buscar archivos por patrón de nombre
- Encontrar todos los archivos de un tipo específico (como todos los archivos `.tsx`)
- Localizar archivos primero al buscar definiciones de clases específicas (como `class Foo`)
- Se pueden lanzar múltiples llamadas Glob en paralelo en un solo mensaje

**No adecuado para:**
- Buscar contenido de archivos — usar Grep
- Exploración abierta que requiere múltiples rondas de búsqueda — usar Task (tipo Explore)

## Notas

- Soporta sintaxis glob estándar: `*` coincide con un nivel, `**` coincide con múltiples niveles, `{}` coincide con múltiples opciones
- Los resultados se ordenan por tiempo de modificación
- Se recomienda más que el comando `find` de Bash

## Significado en cc-viewer

Las llamadas a Glob aparecen en el registro de solicitudes como pares de content blocks `tool_use` / `tool_result`. El `tool_result` contiene la lista de rutas de archivos coincidentes.

## Texto original

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
