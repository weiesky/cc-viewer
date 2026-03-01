# WebSearch

## Definición

Ejecuta consultas en motores de búsqueda y devuelve resultados de búsqueda para obtener información actualizada.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `query` | string | Sí | Consulta de búsqueda (mínimo 2 caracteres) |
| `allowed_domains` | string[] | No | Solo incluir resultados de estos dominios |
| `blocked_domains` | string[] | No | Excluir resultados de estos dominios |

## Casos de uso

**Adecuado para:**
- Obtener información actualizada más allá de la fecha de corte del conocimiento del modelo
- Buscar eventos actuales y datos recientes
- Buscar la documentación técnica más reciente

## Notas

- Los resultados de búsqueda se devuelven en formato de hipervínculos markdown
- Después de usar, se debe incluir una sección "Sources:" al final de la respuesta, listando las URLs relevantes
- Soporta filtrado de dominios (incluir/excluir)
- Se debe usar el año actual en las consultas de búsqueda
- Solo disponible en Estados Unidos

## Significado en cc-viewer

Las llamadas a WebSearch aparecen en el registro de solicitudes como pares de content blocks `tool_use` / `tool_result`. El `tool_result` contiene la lista de resultados de búsqueda.

## Texto original

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
