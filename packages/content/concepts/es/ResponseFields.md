# Referencia de campos del cuerpo de respuesta

Referencia de campos del cuerpo de respuesta de la API de Claude `/v1/messages`.

## Campos de nivel superior

| Campo | Tipo | Descripción |
|-------|------|-------------|
| **model** | string | Nombre del modelo realmente utilizado, p. ej. `claude-opus-4-6` |
| **id** | string | Identificador único de esta respuesta, p. ej. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Siempre `"message"` |
| **role** | string | Siempre `"assistant"` |
| **content** | array | Array de bloques de contenido generados por el modelo, que incluyen texto, llamadas a herramientas, proceso de pensamiento, etc. |
| **stop_reason** | string | Razón de la detención: `"end_turn"` (finalización normal), `"tool_use"` (se necesita ejecutar una herramienta), `"max_tokens"` (se alcanzó el límite de tokens) |
| **stop_sequence** | string/null | La secuencia que provocó la detención, generalmente `null` |
| **usage** | object | Estadísticas de uso de tokens (ver más abajo) |

## Tipos de bloques de content

| Tipo | Descripción |
|------|-------------|
| **text** | Respuesta de texto del modelo, contiene un campo `text` |
| **tool_use** | Solicitud de llamada a herramienta, contiene `name` (nombre de la herramienta), `input` (parámetros), `id` (ID de la llamada, usado para asociar con tool_result) |
| **thinking** | Contenido de pensamiento extendido (solo aparece cuando el modo de pensamiento está activado), contiene un campo `thinking` |

## Detalle de campos de usage

| Campo | Descripción |
|-------|-------------|
| **input_tokens** | Número de tokens de entrada que no alcanzaron la caché (facturados a precio completo) |
| **cache_creation_input_tokens** | Número de tokens de nuevas entradas de caché creadas (escritura en caché, facturación superior a la entrada normal) |
| **cache_read_input_tokens** | Número de tokens que alcanzaron la caché (lectura de caché, facturación mucho menor que la entrada normal) |
| **output_tokens** | Número de tokens generados por el modelo |
| **service_tier** | Nivel de servicio, p. ej. `"standard"` |
| **inference_geo** | Geografía de inferencia, p. ej. `"not_available"` indica que no se proporcionó información geográfica |

## Subcampos de cache_creation

| Campo | Descripción |
|-------|-------------|
| **ephemeral_5m_input_tokens** | Número de tokens de creación de caché a corto plazo con TTL de 5 minutos |
| **ephemeral_1h_input_tokens** | Número de tokens de creación de caché a largo plazo con TTL de 1 hora |

> **Sobre la facturación de caché**: El precio unitario de `cache_read_input_tokens` es mucho menor que el de `input_tokens`, mientras que el precio unitario de `cache_creation_input_tokens` es ligeramente superior al de la entrada normal. Por lo tanto, mantener una alta tasa de aciertos de caché en conversaciones continuas puede reducir significativamente los costos. Puede monitorear visualmente esta proporción a través de la métrica "Tasa de aciertos" en cc-viewer.

## Significado de stop_reason

- **end_turn**: El modelo completó su respuesta normalmente
- **tool_use**: El modelo necesita llamar a una herramienta; el contenido incluirá un bloque `tool_use`. La siguiente solicitud debe añadir un `tool_result` en los mensajes para continuar la conversación
- **max_tokens**: La respuesta fue truncada al alcanzar el límite de `max_tokens` y puede estar incompleta
