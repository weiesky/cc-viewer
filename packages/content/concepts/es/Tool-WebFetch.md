# WebFetch

Recupera el contenido de una página web pública, convierte el HTML a Markdown y ejecuta un modelo auxiliar pequeño sobre el resultado usando un prompt en lenguaje natural para extraer la información que necesitas.

## Cuándo usar

- Leer una página de documentación pública, un post de blog o un RFC referenciado en la conversación.
- Extraer un dato específico, fragmento de código o tabla de una URL conocida sin cargar la página completa en el contexto.
- Resumir notas de lanzamiento o changelogs de un recurso web abierto.
- Consultar la referencia de API pública de una librería cuando la fuente no está en el repositorio local.
- Seguir un enlace que el usuario pegó en el chat para responder una pregunta de seguimiento.

## Parámetros

- `url` (string, obligatorio): Una URL absoluta completamente formada. El `http://` plano se actualiza automáticamente a `https://`.
- `prompt` (string, obligatorio): La instrucción pasada al modelo de extracción pequeño. Describe exactamente qué extraer de la página, como "listar todas las funciones exportadas" o "devolver la versión mínima soportada de Node".

## Ejemplos

### Ejemplo 1: Extraer un valor por defecto de configuración

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

La herramienta obtiene la página de documentación de Vite, la convierte a Markdown y devuelve una respuesta corta como "El valor por defecto es `5173`; acepta solo un número."

### Ejemplo 2: Resumir una sección de changelog

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Útil cuando el usuario pregunta "¿qué cambió en Node 20.11?" y la página de lanzamiento es larga.

## Notas

- `WebFetch` falla en cualquier URL que requiera autenticación, cookies o VPN. Para Google Docs, Confluence, Jira, recursos privados de GitHub o wikis internas, usa un servidor MCP dedicado que proporcione acceso autenticado.
- Para cualquier cosa alojada en GitHub (PRs, issues, blobs de archivo, respuestas de API), prefiere el CLI `gh` a través de `Bash` en lugar de hacer scraping de la UI web. `gh pr view`, `gh issue view` y `gh api` devuelven datos estructurados y funcionan contra repositorios privados.
- Los resultados pueden ser resumidos cuando la página obtenida es muy grande. Si necesitas texto exacto, acota el `prompt` para pedir un extracto literal.
- Se aplica una caché autolimpiante de 15 minutos por URL. Las llamadas repetidas a la misma página durante una sesión son casi instantáneas pero pueden devolver contenido ligeramente obsoleto. Si la frescura importa, menciónalo en el prompt o espera a que pase la caché.
- Si el host objetivo emite una redirección entre hosts, la herramienta devuelve la nueva URL en un bloque de respuesta especial y no la sigue automáticamente. Vuelve a invocar `WebFetch` con la URL de destino de la redirección si aún quieres el contenido.
- El prompt es ejecutado por un modelo más pequeño y rápido que el asistente principal. Mantenlo estrecho y concreto; el razonamiento complejo de varios pasos se maneja mejor leyendo el Markdown crudo tú mismo tras obtenerlo.
- Nunca pases secretos, tokens o identificadores de sesión incrustados en la URL — el contenido de la página y las cadenas de consulta reflejadas en la salida pueden ser registradas por servicios upstream.
