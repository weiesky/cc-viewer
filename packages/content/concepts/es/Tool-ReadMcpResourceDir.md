# ReadMcpResourceDir

Lista las entradas de un recurso estilo directorio expuesto por un servidor MCP conectado, direccionado por su URI.

## Cuándo usar

- Un servidor MCP organiza los recursos jerárquicamente y necesitas enumerar un nivel de esa jerarquía.
- Quieres explorar antes de leer recursos individuales con `ReadMcpResource`.

## Activación

- Siempre habilitado, pero no expuesto en la lista de herramientas del modelo — pensado para uso thin-client / sidecar.

## Parámetros

- `server` (string, obligatorio): El nombre del servidor MCP.
- `uri` (string, obligatorio): La URI del recurso de directorio a listar.

## Ejemplos

### Ejemplo 1: Listar un directorio de recursos

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Devuelve las entradas hijas que el servidor expone bajo esa URI de directorio.

## Notas

- Solo los servidores que modelan sus recursos como directorios admiten esto; los servidores planos devolverán un error o un listado vacío — recurre a `ListMcpResources`.
- Combínalo con `ReadMcpResource` para profundizar en las entradas que parezcan relevantes.
