# ReadMcpResource

Lee un único recurso expuesto por un servidor MCP (Model Context Protocol) conectado, direccionado por su URI.

## Cuándo usar

- Un servidor MCP anuncia un recurso (archivo, registro, documento) cuyo contenido necesitas en el contexto.
- Tienes una URI de recurso concreta — de `ListMcpResources`, de la documentación del servidor o de un resultado de herramienta anterior.

## Activación

- Siempre habilitado, pero no expuesto en la lista de herramientas del modelo — pensado para uso thin-client / sidecar.

## Parámetros

- `server` (string, obligatorio): El nombre del servidor MCP.
- `uri` (string, obligatorio): La URI del recurso a leer.

## Ejemplos

### Ejemplo 1: Leer un recurso de servidor por URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Devuelve el contenido del recurso tal como lo proporciona el servidor MCP `github`.

## Notas

- Usa `ListMcpResources` primero si no sabes qué recursos expone un servidor; usa `ReadMcpResourceDir` para listados estilo directorio.
- El esquema de URI es específico del servidor (`file://`, `https://`, esquemas personalizados) — comprueba lo que anuncia el servidor objetivo.
