# executeCode (mcp__ide__executeCode)

## Definición

Ejecuta código Python en el kernel de Jupyter del archivo notebook actual.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `code` | string | Sí | Código Python a ejecutar |

## Casos de uso

**Adecuado para:**
- Ejecutar código en un entorno Jupyter notebook
- Probar fragmentos de código
- Análisis de datos y cálculos

**No adecuado para:**
- Ejecución de código fuera del entorno Jupyter — usar Bash
- Modificar archivos — usar Edit o Write

## Notas

- Esta es una herramienta MCP (Model Context Protocol), proporcionada por la integración con el IDE
- El código se ejecuta en el kernel de Jupyter actual, el estado persiste entre llamadas
- A menos que el usuario lo solicite explícitamente, se debe evitar declarar variables o modificar el estado del kernel
- El estado se pierde al reiniciar el kernel

## Significado en cc-viewer

executeCode es una herramienta MCP que aparece en el array `tools` del registro de solicitudes con el nombre `mcp__ide__executeCode`. Sus llamadas y retornos siguen el patrón estándar `tool_use` / `tool_result`. La adición/eliminación de herramientas MCP causa cambios en el array tools, lo que puede activar la reconstrucción de caché.

## Texto original

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
