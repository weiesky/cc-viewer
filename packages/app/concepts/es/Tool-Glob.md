# Glob

Compara nombres de archivo contra un patrón glob y devuelve las rutas ordenadas por tiempo de modificación más reciente primero. Optimizado para localizar archivos rápidamente en bases de código de cualquier tamaño sin recurrir a `find` en el shell.

## Cuándo usar

- Enumerar cada archivo de una extensión específica (por ejemplo, todos los archivos `*.ts` bajo `src`)
- Descubrir archivos de configuración o fixtures por convención de nombre (`**/jest.config.*`, `**/*.test.tsx`)
- Estrechar la superficie de búsqueda antes de ejecutar un `Grep` dirigido
- Verificar si un archivo ya existe en un patrón conocido antes de llamar a `Write`
- Encontrar archivos modificados recientemente apoyándose en el orden por tiempo de modificación

## Parámetros

- `pattern` (string, obligatorio): La expresión glob a buscar. Admite `*` para comodines de un solo segmento, `**` para coincidencias recursivas y `{a,b}` para alternativas, por ejemplo `src/**/*.{ts,tsx}`.
- `path` (string, opcional): Directorio en el que ejecutar la búsqueda. Debe ser una ruta de directorio válida cuando se proporcione. Omite el campo por completo para buscar en el directorio de trabajo actual. No pases las cadenas `"undefined"` ni `"null"`.

## Ejemplos

### Ejemplo 1: Todos los archivos fuente TypeScript
Llama a `Glob` con `pattern: "src/**/*.ts"`. El resultado es una lista ordenada por mtime, por lo que los archivos editados más recientemente aparecen primero, lo que es útil para enfocarse en puntos calientes.

### Ejemplo 2: Localizar un candidato de definición de clase
Cuando sospechas que una clase vive en un archivo cuyo nombre no conoces, busca con `pattern: "**/*UserService*"` para estrechar los candidatos, luego sigue con `Read` o `Grep`.

### Ejemplo 3: Descubrimiento en paralelo antes de una tarea mayor
En un solo mensaje, emite múltiples llamadas `Glob` (por ejemplo una para `**/*.test.ts` y otra para `**/fixtures/**`) para que ambas se ejecuten en paralelo y sus resultados puedan correlacionarse.

## Notas

- Los resultados se ordenan por tiempo de modificación del archivo (más reciente primero), no alfabéticamente. Ordena en el lado cliente si necesitas un orden estable.
- Los patrones son evaluados por la herramienta, no por el shell; no necesitas entrecomillarlos ni escaparlos como lo harías en la línea de comandos.
- Para exploración abierta que requiere varias rondas de búsqueda y razonamiento, delega a una `Agent` con el tipo de agente Explore en lugar de encadenar muchas llamadas `Glob`.
- Prefiere `Glob` sobre invocaciones de `find` o `ls` en `Bash` para descubrir nombres de archivo; maneja los permisos de forma consistente y devuelve salida estructurada.
- Cuando buscas contenido dentro de archivos en lugar de nombres de archivo, usa `Grep` en su lugar.
