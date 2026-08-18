# SuggestPluginInstall

Muestra una tarjeta de instalación de plugin en línea a partir de resultados de `SearchPlugins`, vinculando las sugerencias de plugins con la solicitud del usuario.

## Cuándo usar

- Una búsqueda de plugins hizo aflorar plugins que coinciden con lo que el usuario intenta hacer, y quieres ofrecerlos para su instalación.

## Parámetros

- `contextLabel` (string, obligatorio): Encabezado corto que vincula la sugerencia con la solicitud del usuario (máximo 128 caracteres).
- `plugins` (array, obligatorio): Plugins procedentes de resultados de `SearchPlugins` — de 1 a 16 entradas, cada una con:
  - `pluginId` (string, obligatorio)
  - `pluginName` (string, obligatorio)
  - `description` (string, obligatorio)
  - `skills` (array, opcional): Hasta 32 entradas `{name, description?}` que describen las skills del plugin.

## Ejemplos

### Ejemplo 1: Ofrecer un plugin coincidente

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

La tarjeta se muestra al usuario; habilitar el plugin ocurre fuera de banda. Llama a `ListPlugins` en el seguimiento para descubrir qué se instaló realmente.

## Notas

- Solo incluye plugins que provengan de resultados de búsqueda — nunca inventes entradas de plugins.
- Deshabilitado bajo configuraciones empresariales HIPAA.
