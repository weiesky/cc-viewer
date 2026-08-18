# ListPlugins

Lista los plugins de claude.ai habilitados del usuario, opcionalmente filtrados por palabra clave.

## Cuándo usar

- Necesitas saber qué plugins ya están habilitados — por ejemplo, para confirmar qué se instaló tras una tarjeta de `SuggestPluginInstall`.
- El usuario pregunta qué plugins tiene.

## Parámetros

- `keywords` (array de strings, opcional): Filtra la lista — hasta 8 elementos, cada uno de 1 a 64 caracteres. Omítelo para listar todo.

## Ejemplos

### Ejemplo 1: Listar plugins habilitados

```
ListPlugins()
```

### Ejemplo 2: Filtrar por palabra clave

```
ListPlugins(keywords=["figma"])
```

## Notas

- Si el catálogo de plugins es inalcanzable (forbidden), la herramienta se degrada a una lista vacía con una advertencia en lugar de fallar.
- La disponibilidad depende del tipo de sesión y del lanzamiento de la función.
