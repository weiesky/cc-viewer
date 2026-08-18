# ToolSearch

Recupera bajo demanda las definiciones de esquema completas de las «herramientas diferidas» para que pasen a ser invocables. Cuando hay muchas herramientas disponibles, algunas no se cargan de entrada — aparecen únicamente por su nombre dentro de los mensajes `<system-reminder>`. Hasta que se recupera su esquema, solo se conoce el nombre y no existe ninguna definición de parámetros, por lo que la herramienta no puede invocarse. `ToolSearch` toma una consulta, la coteja con la lista de herramientas diferidas y devuelve las definiciones JSONSchema completas de las herramientas coincidentes dentro de un bloque `<functions>`. Una vez que el esquema de una herramienta aparece en el resultado, es invocable exactamente igual que cualquier herramienta definida al principio del prompt.

## Cuándo usar

- Necesitas una herramienta diferida — su nombre aparece en un `<system-reminder>`, pero no hay ninguna definición de parámetros para ella en la lista de herramientas de nivel superior.
- Quieres usar las herramientas de un servidor MCP (p. ej. Slack, Gmail, computer-use) que se cargan bajo demanda.
- No estás seguro del nombre exacto de la herramienta para una capacidad y quieres hacer aflorar candidatas por palabra clave de una sola vez.

Si el esquema de una herramienta ya está en el contexto, no vuelvas a buscar — simplemente invócala.

## Activación

- Activado por defecto.
- Se desactiva cuando `ANTHROPIC_BASE_URL` apunta a un endpoint que no es de Anthropic (salvo que `ENABLE_TOOL_SEARCH` esté establecido), cuando `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` está establecido, cuando el modelo carece de soporte de referencia de herramientas (modelos Vertex AI anteriores a Claude 4.5), o cuando se deniega mediante `"deny": ["ToolSearch"]`.

## Parámetros

- `query` (string, obligatorio): La consulta usada para localizar herramientas diferidas. Se admiten tres formas:
  - `select:Read,Edit,Grep` — recuperar estas herramientas exactas por su nombre.
  - `notebook jupyter` — búsqueda por palabra clave, devolviendo hasta `max_results` mejores coincidencias.
  - `+slack send` — exigir que `slack` aparezca en el nombre de la herramienta y luego clasificar por los términos restantes.
- `max_results` (number, opcional): Número máximo de resultados a devolver. Por defecto es 5.

## Ejemplos

### Ejemplo 1: Recuperar por nombre exacto

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Ejemplo 2: Búsqueda por palabra clave

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Ejemplo 3: Cargar un kit de herramientas MCP completo de una vez

Al cargar en bloque todas las herramientas de un servidor MCP (p. ej. computer-use), usa una sola búsqueda por palabra clave en lugar de seleccionar cada una — el nombre del servidor como subcadena coincide con todas las herramientas de ese servidor:

```
ToolSearch(query="computer-use", max_results=30)
```

## Notas

- Antes de invocar una herramienta diferida debes recuperar primero su esquema con `ToolSearch` — invocarla directamente falla porque falta la definición de parámetros.
- Al cargar en bloque un kit de herramientas completo (p. ej. todas las herramientas de un servidor MCP), prefiere una sola búsqueda por palabra clave en lugar de muchas llamadas `select:` para reducir los viajes de ida y vuelta.
- Una vez recuperado el esquema, la herramienta se comporta exactamente como cualquier herramienta normal; no vuelvas a buscar la misma herramienta.
- Los resultados regresan como un bloque `<functions>`, cada herramienta en una sola línea `<function>{...}</function>` — la misma codificación que la lista de herramientas de nivel superior.
