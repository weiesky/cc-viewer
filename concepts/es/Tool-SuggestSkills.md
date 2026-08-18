# SuggestSkills

Muestra una tarjeta de skills independientes que el usuario puede añadir (skills que aún no están habilitadas), basada en palabras clave de tema.

## Cuándo usar

- La solicitud del usuario coincide con skills que no tiene habilitadas (`trigger="user_asked"` cuando las pidió, `trigger="proactive"` cuando la sugieres sin que te lo pidan).

## Parámetros

- `keywords` (array de strings, obligatorio): Palabras clave de tema de la solicitud del usuario. De 1 a 8 elementos, cada uno de 1 a 64 caracteres.
- `contextLabel` (string, opcional): Etiqueta corta que vincula la sugerencia con la solicitud (máximo 128 caracteres).
- `trigger` (string, opcional): Cómo empezó esta sugerencia — `user_asked` o `proactive`.

## Ejemplos

### Ejemplo 1: Sugerir skills por tema

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Las skills ya habilitadas se filtran fuera del resultado.

## Notas

- Solo muestra una tarjeta de sugerencia — añadir una skill ocurre fuera de banda; llama a `ListSkills` después para confirmarlo.
- Deshabilitado bajo configuraciones empresariales HIPAA.
