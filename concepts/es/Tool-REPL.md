# REPL

Ejecuta JavaScript en un contexto vm de Node.js persistente dentro de la sesión. Se admite `await` de nivel superior, y las variables/funciones definidas en una llamada siguen disponibles en llamadas posteriores.

## Cuándo usar

- Cálculo rápido, transformación de datos o manipulación de JSON que es más fácil en código que en one-liners de shell.
- Scripting de múltiples pasos donde el estado intermedio debe persistir entre llamadas (contadores, resultados acumulados).
- Probar interactivamente una API o el comportamiento de una librería antes de escribirlo en un archivo.

## Activación

- Desactivado por defecto — establece `CLAUDE_CODE_REPL=true` para habilitarlo.
- En sesiones de terminal (`cli`) y claude.ai (`remote`), un feature flag del lado del servidor también puede habilitarlo.
- Cuando está desactivado, REPL queda oculto de la lista de herramientas del modelo. Cuando está activado, `Read`, `Glob`, `Grep`, `Bash`, `PowerShell` y `NotebookEdit` se sustituyen por atajos de REPL.

## Parámetros

- `code` (string, obligatorio): Código JavaScript a ejecutar. Admite await de nivel superior. El estado persiste entre llamadas.
- `description` (string, opcional): Descripción clara y concisa de lo que hace este script, en voz activa (5–10 palabras), p. ej. "Trace upgrade message to its GrowthBook flag".
- `timeout` (number, opcional): Timeout en milisegundos. Por defecto 30000; máximo 600000.

## Ejemplos

### Ejemplo 1: Calcular y reutilizar estado

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

Devuelve `2`; `counts` permanece definida para llamadas REPL posteriores en la misma sesión.

### Ejemplo 2: Await de nivel superior con un timeout más largo

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## Notas

- El estado es por sesión: reiniciar la sesión borra todas las definiciones.
- Esto es un entorno JavaScript (Node) — usa Bash para comandos shell, trabajo pesado de sistema de archivos o runtimes que no sean JS.
- El código de larga ejecución debe establecer un `timeout` explícito; el valor por defecto de 30s interrumpe cualquier cosa más lenta.
