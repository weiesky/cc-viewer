# Contenido de la Caché KV

## ¿Qué es el Prompt Caching?

Cuando conversas con Claude, cada solicitud de API envía el contexto completo de la conversación (prompt del sistema + definiciones de herramientas + mensajes históricos). El mecanismo de prompt caching de Anthropic almacena en caché el contenido del prefijo previamente calculado en el lado del servidor. Si el prefijo de una solicitud posterior coincide, el resultado en caché se reutiliza directamente, omitiendo cálculos redundantes y reduciendo significativamente la latencia y los costos.

En cc-viewer, este mecanismo se denomina "KV-Cache", que corresponde al prompt caching a nivel de API de Anthropic, no a la caché key-value dentro de las capas de atención del transformer del propio LLM.

## Cómo funciona la caché

El prompt caching de Anthropic concatena las claves de caché en un orden fijo:

```
Herramientas → Prompt del sistema → Mensajes (hasta el punto de ruptura de caché)
```

Mientras este prefijo coincida exactamente con cualquier solicitud dentro de la ventana TTL, la API accede a la caché (devuelve `cache_read_input_tokens`) en lugar de recalcular (`cache_creation_input_tokens`).

> **Claude Code no depende estrictamente del atributo `cache_control`. El servidor eliminará algunos de estos atributos según corresponda, pero el almacenamiento en caché sigue funcionando correctamente. Por lo tanto, no ver `cache_control` no significa que el contenido no esté en caché.**
>
> Para clientes especiales como Claude Code, el servidor de Anthropic no depende completamente del atributo `cache_control` en las solicitudes para determinar el comportamiento de la caché. El servidor aplica automáticamente políticas de caché a campos específicos (como el prompt del sistema y las definiciones de herramientas), incluso cuando la solicitud no incluye explícitamente marcadores `cache_control`. Por lo tanto, cuando no veas este atributo en el cuerpo de la solicitud, no te confundas — el servidor ya ha realizado la operación de caché entre bastidores, simplemente no ha expuesto esta información al cliente. Este es un entendimiento tácito entre Claude Code y la API de Anthropic.

## ¿Qué es el "contenido actual de la caché KV"?

El "contenido actual de la caché KV" mostrado en cc-viewer se extrae de la última solicitud de MainAgent, específicamente el contenido antes del límite de caché (cache breakpoint). Incluye:

- **Prompt del sistema**: Las instrucciones del sistema de Claude Code, incluyendo directivas centrales del agente, especificaciones de uso de herramientas, instrucciones del proyecto CLAUDE.md, información del entorno, etc.
- **Herramientas**: La lista actual de definiciones de herramientas disponibles (como Read, Write, Bash, Agent, herramientas MCP, etc.)
- **Mensajes**: La parte del historial de conversación que está almacenada en caché (generalmente mensajes anteriores, hasta el último marcador `cache_control`)

## ¿Por qué consultar el contenido de la caché?

1. **Entender el contexto**: Ver qué contenidos "recuerda" Claude actualmente para evaluar si su comportamiento cumple las expectativas
2. **Optimización de costos**: Los accesos a caché cuestan mucho menos que el recálculo. Consultar el contenido de la caché te ayuda a entender por qué ciertas solicitudes desencadenaron una reconstrucción de caché
3. **Depuración de conversaciones**: Cuando las respuestas de Claude no son las esperadas, verificar el contenido de la caché permite confirmar que el prompt del sistema y los mensajes históricos son correctos
4. **Monitoreo de la calidad del contexto**: Durante la depuración, cambios de configuración o ajustes de prompts, KV-Cache-Text proporciona una vista centralizada para confirmar rápidamente si el contexto principal se ha degradado o ha sido contaminado inesperadamente, sin necesidad de revisar los mensajes brutos uno por uno

## Estrategia de caché multinivel

La KV-Cache correspondiente a Claude Code no es una sola caché. El servidor genera cachés separadas para las Herramientas y el Prompt del sistema, independientes de la caché de Mensajes. La ventaja de este diseño es: cuando la pila de mensajes se corrompe (por ejemplo, truncamiento de contexto, modificación de mensajes) y necesita reconstruirse, no invalida las cachés de Herramientas y Prompt del sistema junto con ella, evitando un recálculo completo.

Esta es una estrategia de optimización actual del lado del servidor, ya que las definiciones de herramientas y el prompt del sistema permanecen relativamente estables durante el uso normal y rara vez cambian. Almacenarlos en caché por separado minimiza la sobrecarga de reconstrucción innecesaria. Por eso, cuando observes la caché, notarás que aparte de las reconstrucciones de herramientas que requieren una actualización completa de la caché, las interrupciones en el prompt del sistema y los mensajes aún tienen cachés heredables disponibles.

## Ciclo de vida de la caché

- **Creación**: En la primera solicitud o después de la expiración de la caché, la API crea una nueva caché (`cache_creation_input_tokens`)
- **Acceso**: En solicitudes posteriores con un prefijo coincidente, se reutiliza la caché (`cache_read_input_tokens`)
- **Expiración**: La caché tiene un TTL (tiempo de vida) de 5 minutos y expira automáticamente después de ese tiempo
- **Reconstrucción**: Cuando el prompt del sistema, la lista de herramientas, el modelo o el contenido de los mensajes cambian, la clave de caché no coincide y desencadena una reconstrucción en el nivel correspondiente
