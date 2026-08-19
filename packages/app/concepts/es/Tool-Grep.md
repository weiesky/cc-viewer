# Grep

Busca contenido de archivos usando el motor ripgrep. Ofrece soporte completo de expresiones regulares, filtrado por tipo de archivo y tres modos de salida para que puedas intercambiar precisión por compacidad.

## Cuándo usar

- Localizar cada sitio de llamada de una función o cada referencia a un identificador
- Verificar si una cadena o mensaje de error aparece en algún lugar del código
- Contar apariciones de un patrón para calibrar el impacto antes de refactorizar
- Estrechar una búsqueda a un tipo de archivo (`type: "ts"`) o glob (`glob: "**/*.tsx"`)
- Extraer coincidencias que abarcan varias líneas, como definiciones de struct multilínea o bloques JSX, con `multiline: true`

## Parámetros

- `pattern` (string, obligatorio): La expresión regular a buscar. Usa la sintaxis de ripgrep, por lo que las llaves literales necesitan escape (por ejemplo `interface\{\}` para encontrar `interface{}`).
- `path` (string, opcional): Archivo o directorio donde buscar. Por defecto, el directorio de trabajo actual.
- `glob` (string, opcional): Filtro de nombre de archivo como `*.js` o `*.{ts,tsx}`.
- `type` (string, opcional): Atajo de tipo de archivo como `js`, `py`, `rust`, `go`. Más eficiente que `glob` para lenguajes estándar.
- `output_mode` (enum, opcional): `files_with_matches` (por defecto, devuelve solo rutas), `content` (devuelve las líneas coincidentes) o `count` (devuelve conteos de coincidencias).
- `-i` (boolean, opcional): Coincidencia insensible a mayúsculas/minúsculas.
- `-n` (boolean, opcional): Incluye números de línea en modo `content`. Por defecto es `true`.
- `-A` (number, opcional): Líneas de contexto a mostrar después de cada coincidencia (requiere modo `content`).
- `-B` (number, opcional): Líneas de contexto antes de cada coincidencia (requiere modo `content`).
- `-C` / `context` (number, opcional): Líneas de contexto a ambos lados de cada coincidencia.
- `multiline` (boolean, opcional): Permite que los patrones abarquen saltos de línea (`.` coincide con `\n`). Por defecto `false`.
- `head_limit` (number, opcional): Limita las líneas, rutas de archivo o entradas de conteo devueltas. Por defecto 250; pasa `0` para ilimitado (úsalo con moderación).
- `offset` (number, opcional): Omite los primeros N resultados antes de aplicar `head_limit`. Por defecto `0`.

## Ejemplos

### Ejemplo 1: Encontrar todos los sitios de llamada de una función
Establece `pattern: "registerHandler\\("`, `output_mode: "content"` y `-C: 2` para ver las líneas circundantes de cada llamada.

### Ejemplo 2: Contar coincidencias por tipo
Establece `pattern: "TODO"`, `type: "py"` y `output_mode: "count"` para ver los totales de TODO por archivo en las fuentes Python.

### Ejemplo 3: Coincidencia de struct multilínea
Usa `pattern: "struct Config \\{[\\s\\S]*?version"` con `multiline: true` para capturar un campo declarado varias líneas dentro de un struct de Go.

## Notas

- Siempre prefiere `Grep` sobre ejecutar `grep` o `rg` a través de `Bash`; la herramienta está optimizada para permisos correctos y salida estructurada.
- El modo de salida por defecto es `files_with_matches`, que es el más económico. Cambia a `content` solo cuando necesites ver las líneas en sí.
- Los flags de contexto (`-A`, `-B`, `-C`) son ignorados a menos que `output_mode` sea `content`.
- Los grandes conjuntos de resultados consumen tokens de contexto. Usa `head_limit`, `offset` o filtros `glob`/`type` más ajustados para mantener el enfoque.
- Para descubrir nombres de archivo, usa `Glob`; para investigaciones abiertas que abarcan muchas rondas, despacha una `Agent` con el agente Explore.
