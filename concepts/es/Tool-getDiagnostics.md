# getDiagnostics (mcp__ide__getDiagnostics)

## Definición

Obtiene información de diagnóstico del lenguaje de VS Code, incluyendo errores de sintaxis, errores de tipo, advertencias de lint, etc.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `uri` | string | No | URI del archivo. Si no se proporciona, obtiene la información de diagnóstico de todos los archivos |

## Casos de uso

**Adecuado para:**
- Verificar problemas semánticos de sintaxis, tipos, lint, etc. del código
- Verificar si se introdujeron nuevos errores después de editar código
- Reemplazar comandos Bash para verificar la calidad del código

**No adecuado para:**
- Ejecutar pruebas — usar Bash
- Verificar errores en tiempo de ejecución — usar Bash para ejecutar el código

## Notas

- Esta es una herramienta MCP (Model Context Protocol), proporcionada por la integración con el IDE
- Solo disponible en entornos VS Code / IDE
- Preferir usar esta herramienta en lugar de comandos Bash para verificar problemas de código

## Texto original

<textarea readonly>Get language diagnostics from VS Code</textarea>
