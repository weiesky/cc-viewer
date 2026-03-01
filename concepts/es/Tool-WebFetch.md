# WebFetch

## Definición

Obtiene el contenido de una página web de una URL especificada, convierte el HTML a markdown y procesa el contenido con un modelo de IA según el prompt.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `url` | string (URI) | Sí | URL completa a obtener |
| `prompt` | string | Sí | Describe qué información extraer de la página |

## Casos de uso

**Adecuado para:**
- Obtener contenido de páginas web públicas
- Consultar documentación en línea
- Extraer información específica de páginas web

**No adecuado para:**
- URLs que requieren autenticación (Google Docs, Confluence, Jira, GitHub, etc.) — buscar primero herramientas MCP dedicadas
- URLs de GitHub — preferir usar el CLI `gh`

## Notas

- La URL debe ser una URL válida completa
- HTTP se actualiza automáticamente a HTTPS
- Los resultados pueden ser resumidos si el contenido es demasiado grande
- Incluye caché con auto-limpieza de 15 minutos
- Cuando la URL redirige a un host diferente, la herramienta devuelve la URL de redirección y se necesita hacer una nueva solicitud con la nueva URL
- Si hay una herramienta web fetch proporcionada por MCP disponible, preferir usar esa

## Significado en cc-viewer

Las llamadas a WebFetch aparecen en el registro de solicitudes como pares de content blocks `tool_use` / `tool_result`. El `tool_result` contiene el resumen del contenido web procesado por IA.

## Texto original

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
