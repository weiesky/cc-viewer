# ListConnectors

Lista los conectores MCP instalados para la organización de claude.ai del usuario, opcionalmente filtrados por palabra clave.

## Cuándo usar

- Necesitas saber qué conectores ya están instalados antes de sugerir otros nuevos.
- El usuario pregunta qué integraciones tiene su organización.

## Activación

- Solo disponible en sesiones remotas (claude.ai) en la API first-party.

## Parámetros

- `keywords` (array de strings, opcional): Filtra la lista — hasta 8 elementos, cada uno de 1 a 64 caracteres. Omítelo para listar todo.

## Ejemplos

### Ejemplo 1: Listar todos los conectores instalados

```
ListConnectors()
```

### Ejemplo 2: Filtrar por palabra clave

```
ListConnectors(keywords=["github"])
```

## Notas

- Combínalo con `SearchMcpRegistry` (descubrimiento) y `SuggestConnectors` (detalles) para el flujo completo de encontrar y habilitar.
