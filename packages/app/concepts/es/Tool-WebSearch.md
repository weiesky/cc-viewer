# WebSearch

Realiza una búsqueda web en vivo y devuelve resultados clasificados que el asistente usa para fundamentar su respuesta en información actual más allá del corte de entrenamiento del modelo.

## Cuándo usar

- Responder preguntas sobre eventos actuales, lanzamientos recientes o noticias de última hora.
- Buscar la última versión de una librería, framework o herramienta CLI.
- Encontrar documentación o posts de blog cuando la URL exacta es desconocida.
- Verificar un hecho que puede haber cambiado desde que el modelo fue entrenado.
- Descubrir múltiples perspectivas sobre un tema antes de obtener cualquier página individual con `WebFetch`.

## Activación

- La disponibilidad depende del proveedor y del modelo: disponible en la API de Anthropic y en Claude Platform on AWS; en Microsoft Foundry requiere un despliegue alojado por Anthropic; en Google Cloud funciona con modelos Claude 4+.
- No disponible en Amazon Bedrock.
- Limita a 200 llamadas por sesión con `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Parámetros

- `query` (string, obligatorio): La consulta de búsqueda. Longitud mínima 2 caracteres. Incluye el año actual cuando preguntes por información "última" o "reciente" para que los resultados estén frescos.
- `allowed_domains` (array de strings, opcional): Restringe los resultados solo a estos dominios, por ejemplo `["nodejs.org", "developer.mozilla.org"]`. Útil cuando confías en una fuente específica.
- `blocked_domains` (array de strings, opcional): Excluye resultados de estos dominios. No pases el mismo dominio a `allowed_domains` y `blocked_domains`.

## Ejemplos

### Ejemplo 1: Búsqueda de versión con año actual

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Devuelve anuncios oficiales y evita sitios agregadores de baja calidad.

### Ejemplo 2: Excluir fuentes ruidosas

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Mantiene los resultados enfocados en avisos de proveedores y rastreadores de seguridad.

## Notas

- Cuando uses `WebSearch` en una respuesta, debes adjuntar una sección `Sources:` al final de tu respuesta listando cada resultado citado como un hiperenlace Markdown con la forma `[Title](URL)`. Este es un requisito estricto, no opcional.
- `WebSearch` solo está disponible para usuarios en los Estados Unidos. Si la herramienta no está disponible en tu región, recurre a `WebFetch` contra una URL conocida o pide al usuario que pegue contenido relevante.
- Cada llamada realiza la búsqueda en un solo viaje de ida y vuelta — no puedes hacer streaming ni paginar. Refina la consulta si el primer conjunto de resultados es desviado.
- La herramienta devuelve fragmentos y metadatos, no el contenido completo de la página. Para leer un resultado específico en profundidad, sigue con `WebFetch` usando la URL devuelta.
- Usa `allowed_domains` para forzar fuentes autoritativas en preguntas sensibles a seguridad como CVEs o cumplimiento, y `blocked_domains` para cortar granjas de SEO que replican documentación.
- Mantén las consultas cortas y basadas en palabras clave. Las preguntas en lenguaje natural funcionan pero tienden a devolver respuestas conversacionales en lugar de fuentes primarias.
- No inventes URLs basadas en intuición de búsqueda — siempre ejecuta la búsqueda y cita lo que la herramienta realmente devolvió.
