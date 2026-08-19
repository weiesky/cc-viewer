# SearchMcpRegistry

Busca en el registro de conectores MCP por palabra clave para descubrir conectores que puedan ayudar a completar la tarea.

## Cuándo usar

- La tarea se beneficiaría de un servicio externo (una base de datos, un rastreador de issues, una API SaaS) y quieres comprobar si existe un conector MCP para él.
- El usuario nombra un producto y pide conectarlo — busca en el registro un conector coincidente.

## Activación

- Solo disponible en sesiones remotas (claude.ai) en la API first-party.

## Parámetros

- `keywords` (array de strings, obligatorio): Frases de palabra clave que describen la intención del usuario o un producto nombrado. De 1 a 8 elementos, cada uno de 1 a 64 caracteres.

## Ejemplos

### Ejemplo 1: Encontrar un conector para un producto nombrado

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Devuelve entradas del registro cuyos conectores coinciden con las palabras clave. Resuelve los detalles completos del conector con `SuggestConnectors`.

## Notas

- Solo lectura y seguro para concurrencia; los resultados están limitados en tamaño.
- Buscar no instala nada — es puramente descubrimiento.
