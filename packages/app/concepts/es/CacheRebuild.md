# Cache Rebuild (Reconstrucción de caché)

## Contexto

El mecanismo de prompt caching de Anthropic concatena secuencialmente system → tools → messages (hasta el cache breakpoint) de la solicitud para formar la clave de caché. Cuando la clave de caché coincide exactamente con la solicitud anterior, la API devuelve `cache_read_input_tokens` (acierto de caché); cuando la clave de caché cambia, la API recrea la caché y devuelve una gran cantidad de `cache_creation_input_tokens`, es decir, una reconstrucción de caché.

La reconstrucción de caché implica facturación adicional de tokens (el precio de cache creation es mayor que el de cache read), por lo que identificar la causa de la reconstrucción tiene valor directo para la optimización de costos.

## Clasificación de causas de reconstrucción de caché

cc-viewer compara los cuerpos de dos solicitudes MainAgent consecutivas para determinar con precisión la causa de la reconstrucción de caché:

| reason | Significado | Método de determinación |
|--------|-------------|------------------------|
| `ttl` | Caché expirada | Han pasado más de 5 minutos desde la última solicitud MainAgent |
| `system_change` | Cambio en el system prompt | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Cambio en las definiciones de herramientas | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Cambio de modelo | `prev.model !== curr.model` |
| `msg_truncated` | Pila de mensajes truncada | La solicitud actual tiene menos mensajes que la anterior, generalmente por truncamiento al desbordar la ventana de contexto |
| `msg_modified` | Mensajes históricos modificados | El contenido de los mensajes prefijo no coincide (en adición normal, el prefijo debería ser idéntico) |
| `key_change` | Cambio de clave desconocido | Fallback cuando ninguna de las condiciones anteriores coincide |

## Prioridad de determinación

1. Primero se verifica el intervalo de tiempo — si supera los 5 minutos, se determina directamente como `ttl`, sin comparar el body
2. Luego se verifican secuencialmente model, system, tools, messages
3. Una solicitud puede coincidir con múltiples causas simultáneamente (por ejemplo, cambio de modelo + cambio de system prompt), en cuyo caso el array `reasons` contiene todos los elementos coincidentes y el tooltip los muestra en líneas separadas

## Escenarios comunes

- **`ttl`**: El usuario pausó la operación por más de 5 minutos y luego continuó, la caché expiró naturalmente
- **`system_change`**: Claude Code actualizó el system prompt (por ejemplo, cargó un nuevo CLAUDE.md, cambios en project instructions)
- **`tools_change`**: La conexión/desconexión de un MCP server causó cambios en la lista de herramientas disponibles
- **`model_change`**: El usuario cambió de modelo mediante el comando `/model`
- **`msg_truncated`**: Una conversación larga activó la gestión de la ventana de contexto, Claude Code truncó los mensajes anteriores
- **`msg_modified`**: Claude Code editó mensajes históricos (por ejemplo, `/compact` reemplazó mensajes originales con resúmenes comprimidos)
