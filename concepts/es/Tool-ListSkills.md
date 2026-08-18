# ListSkills

Lista las skills de claude.ai habilitadas del usuario, opcionalmente filtradas por palabra clave.

## Cuándo usar

- Necesitas la lista autoritativa de skills habilitadas actualmente — antes de invocar una, o para confirmar qué añadió una tarjeta de `SuggestSkills`.
- El usuario pregunta qué skills tiene.

## Parámetros

- `keywords` (array de strings, opcional): Filtra la lista — hasta 8 elementos, cada uno de 1 a 64 caracteres. Omítelo para listar todo.

## Ejemplos

### Ejemplo 1: Listar skills habilitadas

```
ListSkills()
```

### Ejemplo 2: Filtrar por palabra clave

```
ListSkills(keywords=["review"])
```

## Notas

- Si el catálogo es inalcanzable (forbidden), la herramienta se degrada a una lista vacía con una advertencia en lugar de fallar.
- Esto lista las skills *habilitadas*; usa `SuggestSkills` para hacer aflorar skills que el usuario podría añadir.
