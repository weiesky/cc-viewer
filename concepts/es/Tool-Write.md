# Write

## Definición

Escribe contenido en el sistema de archivos local. Si el archivo ya existe, lo sobrescribe.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `file_path` | string | Sí | Ruta absoluta del archivo (debe ser ruta absoluta) |
| `content` | string | Sí | Contenido a escribir |

## Casos de uso

**Adecuado para:**
- Crear archivos nuevos
- Cuando se necesita reescribir completamente el contenido de un archivo

**No adecuado para:**
- Modificar contenido parcial de un archivo — usar Edit
- No se deben crear proactivamente archivos de documentación (*.md) o README, a menos que el usuario lo solicite explícitamente

## Notas

- Si el archivo de destino ya existe, se debe leer primero con Read, de lo contrario fallará
- Sobrescribe todo el contenido del archivo existente
- Preferir usar Edit para editar archivos existentes, Write solo para crear archivos nuevos o reescrituras completas

## Significado en cc-viewer

Las llamadas a Write aparecen en el registro de solicitudes como content blocks `tool_use`, cuyo `input.content` contiene el contenido completo escrito.

## Texto original

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
