# Campos del cuerpo de la solicitud (Request Body)

Descripción de los campos de nivel superior del cuerpo de la solicitud `/v1/messages` de la API de Claude.

## Lista de campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| **model** | string | Nombre del modelo a utilizar, por ejemplo `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Historial de mensajes de la conversación. Cada mensaje contiene `role` (user/assistant) y `content` (un array de bloques como texto, imagen, tool_use, tool_result, etc.) |
| **system** | array | System prompt. Contiene las instrucciones principales de Claude Code, directrices de uso de herramientas, información del entorno, contenido de CLAUDE.md, etc. Los bloques con `cache_control` están sujetos a prompt caching |
| **tools** | array | Lista de definiciones de herramientas disponibles. Cada herramienta contiene `name`, `description` e `input_schema` (JSON Schema). MainAgent normalmente tiene más de 20 herramientas, mientras que SubAgent solo tiene unas pocas |
| **metadata** | object | Metadatos de la solicitud, generalmente contiene `user_id` para identificar al usuario |
| **max_tokens** | number | Número máximo de tokens para una respuesta individual del modelo, por ejemplo `16000`, `64000` |
| **thinking** | object | Configuración de pensamiento extendido. `type: "enabled"` activa el modo de pensamiento, `budget_tokens` controla el límite de tokens de pensamiento |
| **context_management** | object | Configuración de gestión de contexto. `truncation: "auto"` permite que Claude Code trunque automáticamente historiales de mensajes demasiado largos |
| **output_config** | object | Configuración de salida, como ajustes de `format` |
| **stream** | boolean | Si se habilitan las respuestas en streaming. Claude Code siempre usa `true` |

## Estructura de messages

El `content` de cada mensaje es un array de bloques. Los tipos comunes incluyen:

- **text**: Contenido de texto plano
- **tool_use**: Invocación de herramienta por el modelo (contiene `name`, `input`)
- **tool_result**: Resultado de la ejecución de la herramienta (contiene `tool_use_id`, `content`)
- **image**: Contenido de imagen (base64 o URL)
- **thinking**: Proceso de pensamiento del modelo (modo de pensamiento extendido)

## Estructura de system

El array del system prompt normalmente contiene:

1. **Instrucciones principales del agente** ("You are Claude Code...")
2. **Directrices de uso de herramientas**
3. **Contenido de CLAUDE.md** (instrucciones a nivel de proyecto)
4. **Recordatorios de habilidades** (skills reminder)
5. **Información del entorno** (SO, shell, estado de git, etc.) — De hecho, Claude Code depende en gran medida de git. Si un proyecto tiene un repositorio git, Claude Code demuestra una mejor comprensión del proyecto, incluyendo la capacidad de obtener cambios remotos e historial de commits para asistir en el análisis

Los bloques marcados con `cache_control: { type: "ephemeral" }` son almacenados en caché por la API de Anthropic durante 5 minutos. Cuando se producen aciertos de caché, se facturan como `cache_read_input_tokens` (significativamente más barato que `input_tokens`).

> **Nota**: Para clientes especiales como Claude Code, el servidor de Anthropic no depende completamente del atributo `cache_control` en la solicitud para determinar el comportamiento de caché. El servidor aplica automáticamente estrategias de caché a campos específicos (como el system prompt y las definiciones de tools), incluso cuando la solicitud no incluye explícitamente marcadores `cache_control`. Por lo tanto, no se sorprenda si no ve este atributo en el cuerpo de la solicitud — el servidor ya ha realizado el almacenamiento en caché entre bastidores, simplemente no expone esta información al cliente. Este es un entendimiento tácito entre Claude Code y la API de Anthropic.
