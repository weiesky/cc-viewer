# ListMcpResources

Lista los recursos expuestos por los servidores MCP conectados, opcionalmente filtrados a un servidor.

## Cuándo usar

- Necesitas descubrir qué recursos (archivos, registros, documentos) ofrece un servidor MCP antes de leerlos.
- Quieres una vista general de todos los recursos de todos los servidores conectados.

## Activación

- Siempre habilitado, pero no expuesto en la lista de herramientas del modelo — pensado para uso thin-client / sidecar.

## Parámetros

- `server` (string, opcional): Nombre del servidor por el que filtrar los recursos. Omítelo para listar recursos de todos los servidores conectados.

## Ejemplos

### Ejemplo 1: Listar todo

```
ListMcpResources()
```

### Ejemplo 2: Listar los recursos de un servidor

```
ListMcpResources(server="github")
```

## Notas

- Este es el paso de descubrimiento: pasa las URIs interesantes a `ReadMcpResource` (recurso único) o `ReadMcpResourceDir` (listados de directorio).
- Los servidores se conectan y desconectan a lo largo de la vida de la sesión; vuelve a listar si se acaba de añadir un servidor.
