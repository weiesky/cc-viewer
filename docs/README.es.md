# CC-Viewer

Un sistema de monitoreo de solicitudes para Claude Code que captura y visualiza todas las solicitudes y respuestas de API en tiempo real. Ayuda a los desarrolladores a monitorear su Context para revisión y depuración durante el Vibe Coding.

[简体中文](./README.zh.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Uso

```bash
npm install -g cc-viewer
```

Después de la instalación, ejecute:

```bash
ccv
```

Este comando configura automáticamente su Claude Code instalado localmente para el monitoreo y agrega un hook de reparación automática en su configuración de shell (`~/.zshrc` o `~/.bashrc`). Luego use Claude Code como de costumbre y abra `http://localhost:7008` en su navegador para ver la interfaz de monitoreo.

Después de una actualización de Claude Code, no se necesita ninguna acción manual — la próxima vez que ejecute `claude`, detectará y reconfigurará automáticamente.

### Desinstalar

```bash
ccv --uninstall
```

## Características

### Monitoreo de solicitudes (Raw Mode)

- Captura en tiempo real de todas las solicitudes de API de Claude Code, incluyendo respuestas en streaming
- El panel izquierdo muestra el método de solicitud, URL, duración y código de estado
- Identifica y etiqueta automáticamente las solicitudes de Main Agent y Sub Agent (subtipos: Bash, Task, Plan, General)
- El panel derecho soporta cambio entre pestañas Request / Response
- El Request Body expande `messages`, `system`, `tools` un nivel por defecto
- El Response Body completamente expandido por defecto
- Alternar entre vista JSON y vista de texto plano
- Copiar contenido JSON con un clic
- Las solicitudes MainAgent soportan Body Diff JSON, mostrando plegado las diferencias con la solicitud MainAgent anterior (solo campos cambiados/añadidos)
- El tooltip de Body Diff JSON se puede cerrar; una vez cerrado, la preferencia se guarda en el servidor y no se muestra de nuevo
- Los encabezados sensibles (`x-api-key`, `authorization`) se enmascaran automáticamente en los archivos de log JSONL para prevenir la filtración de credenciales
- Estadísticas de uso de Token en línea por solicitud (tokens de entrada/salida, creación/lectura de caché, tasa de aciertos)

### Chat Mode

Haga clic en el botón "Chat mode" en la esquina superior derecha para analizar el historial completo de conversación del Main Agent en una interfaz de chat:

- Mensajes del usuario alineados a la derecha (burbujas azules), respuestas del Main Agent alineadas a la izquierda (burbujas oscuras) con renderizado Markdown
- Mensajes `/compact` detectados automáticamente y mostrados colapsados, clic para expandir el resumen completo
- Resultados de llamadas a herramientas mostrados en línea dentro del mensaje Assistant correspondiente
- Bloques `thinking` colapsados por defecto, renderizados como Markdown, clic para expandir; soporta traducción con un clic
- `tool_use` mostrado como tarjetas compactas de llamada a herramientas (Bash, Read, Edit, Write, Glob, Grep, Task tienen visualizaciones dedicadas)
- Resultados de herramientas Task (SubAgent) renderizados como Markdown
- Mensajes de selección del usuario (AskUserQuestion) mostrados en formato de pregunta y respuesta
- Etiquetas del sistema (`<system-reminder>`, `<project-reminder>`, etc.) auto-colapsadas
- Mensajes de carga de Skill detectados automáticamente y colapsados, mostrando el nombre del Skill; clic para expandir la documentación completa (renderizado Markdown)
- Texto del sistema auto-filtrado, mostrando solo la entrada real del usuario
- Visualización segmentada multi-sesión (segmentación automática después de `/compact`, `/clear`, etc.)
- Cada mensaje muestra una marca de tiempo con precisión de segundos, derivada del timing de la solicitud API
- Panel de configuración: alternar el estado de colapso predeterminado para resultados de herramientas y bloques de pensamiento

### Traducción

- Los bloques thinking y los mensajes del Assistant soportan traducción con un clic
- Basado en la API de Claude Haiku, soporta autenticación por API Key (`x-api-key`) y OAuth Bearer Token
- Los resultados de traducción se almacenan en caché automáticamente; haga clic de nuevo para volver al texto original
- Se muestra una animación de carga giratoria durante la traducción

### Estadísticas de Token

Panel flotante en el área del encabezado:

- Conteo de Token agrupado por modelo (entrada/salida)
- Conteos de creación/lectura de Cache y tasa de aciertos de Cache
- Cuenta regresiva de expiración del Cache del Main Agent

### Gestión de Logs

A través del menú desplegable de CC-Viewer en la esquina superior izquierda:

- Importar logs locales: explorar archivos de log históricos, agrupados por proyecto, se abre en nueva ventana
- Cargar archivo JSONL local: seleccionar y cargar directamente un archivo `.jsonl` local (hasta 200 MB)
- Descargar log actual: descargar el archivo de log JSONL de monitoreo actual
- Exportar prompts del usuario: extraer y mostrar todas las entradas del usuario, con etiquetas XML (system-reminder, etc.) colapsables; comandos slash (`/model`, `/context`, etc.) mostrados como entradas independientes; etiquetas relacionadas con comandos ocultas automáticamente del contenido del prompt
- Exportar prompts a TXT: exportar los prompts del usuario (solo texto, excluyendo etiquetas del sistema) a un archivo `.txt` local

### Soporte multilingüe

CC-Viewer soporta 18 idiomas, cambiando automáticamente según la configuración regional del sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## Licencia

MIT
