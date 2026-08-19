# Artifact

Renderiza un archivo HTML o Markdown en un Artifact — una página web alojada en claude.ai que es privada de forma predeterminada y que el usuario puede abrir en un navegador y luego elegir compartir. Úsalo cuando la comunicación visual supera al texto del terminal.

## Cuándo usar

- Publicar un entregable visual: un informe, un panel, una investigación de errores o un mockup de UI
- Actualizar una página publicada anteriormente en su lugar (el mismo archivo → la misma URL al redesplegar)
- Listar los artifacts existentes del usuario para encontrar uno de una sesión anterior (`action: "list"`)
- **No** para contenido que debe mantenerse local, respuestas de texto simple o cualquier cosa que necesite recursos de red externos al visualizar — una CSP estricta bloquea cualquier host externo

## Activación

- Requiere un plan Pro, Max, Team o Enterprise con inicio de sesión en claude.ai (`/login`).
- Solo en la API de Anthropic — no disponible en Amazon Bedrock, Google Cloud ni Microsoft Foundry.
- Requiere Claude Code ≥ 2.1.183 o la app de escritorio ≥ 1.13576.0.
- Desactívalo con el ajuste `disableArtifact` o `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Parámetros

- `file_path` (cadena): Ruta al archivo `.html` o `.md` a renderizar. El archivo se envuelve en un esqueleto de documento al publicarse, así que escribe el contenido de la página directamente — sin etiquetas `<!DOCTYPE>`, `<html>`, `<head>` o `<body>`. La misma ruta → la misma URL al redesplegar; una ruta diferente reclama una URL nueva.
- `favicon` (cadena, requerido para publicar): Uno o dos emoji usados como icono de pestaña del navegador (p. ej. `"📊"`). Solo emoji, sin markup. Mantenlo igual entre redespliegues — los usuarios encuentran su pestaña por el icono.
- `description` (cadena): Un subtítulo de una sola línea que se muestra en la tarjeta de galería de artifacts.
- `url` (cadena, opcional): Pasa la URL de un artifact existente para actualizarlo desde una conversación que no lo publicó. Sin él, una nueva conversación siempre acuña una nueva URL.
- `label` (cadena, opcional): Nombre de versión corto y legible (máx. 60 caracteres) mostrado en el selector de versiones.
- `action` (cadena, opcional): `"publish"` (predeterminado) o `"list"` — enumera los artifacts publicados del usuario (título, URL, última actualización), opcionalmente con `limit`.
- `force` (booleano, opcional): Sobrescribir sin verificación de conflictos. Solo después de un 409 de escritura concurrente, una vez conciliado.

## Notas

- **Solo contenido autocontenido.** Una CSP estricta bloquea solicitudes a cualquier host externo — scripts CDN, hojas de estilo externas, imágenes remotas, fetch/WebSockets. Integra todo CSS/JS e incluye assets como URIs `data:`.
- **Receptivo y consciente del tema.** Las páginas se renderizan en el tema claro u oscuro del usuario; estiliza ambos (`prefers-color-scheme` más la anulación `data-theme` del usuario). El contenido ancho se desplaza dentro de su contenedor — el cuerpo de la página nunca debe desplazarse horizontalmente.
- **Actualizar entre conversaciones necesita `url`.** Redesplegar la misma ruta solo reutiliza la URL dentro de la conversación que la publicó; para mantener el enlace de un artifact antiguo, encuentra su URL con `action: "list"` y pásala como `url`.
- **Publicar es de cara al exterior.** El contenido enviado al servicio de artifacts puede almacenarse en caché incluso si se elimina más adelante — no publiques nada que deba mantenerse privado en la máquina.
- **Volver a leer con WebFetch.** Las URLs de artifacts de claude.ai se pueden obtener mediante WebFetch (no con curl, que obtiene la shell de la aplicación).
