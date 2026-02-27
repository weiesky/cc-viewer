# CC-Viewer

Sistema de monitoreo de solicitudes para Claude Code que captura y visualiza en tiempo real todas las solicitudes y respuestas de API (texto original, sin recortes). Permite a los desarrolladores monitorear su Context para revisar y solucionar problemas durante el Vibe Coding.

[English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | Español | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## Uso

### Instalación

```bash
npm install -g cc-viewer
```

### Ejecutar y configuración automática

```bash
ccv
```

Este comando detecta automáticamente el método de instalación local de Claude Code (NPM o Native Install) y se adapta en consecuencia.

- **Instalación NPM**: Inyecta automáticamente el script interceptor en `cli.js` de Claude Code.
- **Native Install**: Detecta automáticamente el binario `claude`, configura un proxy transparente local y establece un Zsh Shell Hook para redirigir el tráfico automáticamente.

### Anulación de configuración (Configuration Override)

Si necesita utilizar un endpoint de API personalizado (por ejemplo, proxy corporativo), simplemente configúrelo en `~/.claude/settings.json` o establezca la variable de entorno `ANTHROPIC_BASE_URL`. `ccv` reconocerá automáticamente esta configuración y reenviará las solicitudes correctamente.

### Modo silencioso (Silent Mode)

De forma predeterminada, `ccv` se ejecuta en modo silencioso al envolver `claude`, lo que garantiza que la salida de su terminal permanezca limpia e idéntica a la experiencia nativa. Todos los registros se capturan en segundo plano y son visibles en `http://localhost:7008`.

Una vez completada la configuración, use el comando `claude` como de costumbre. Abra `http://localhost:7008` para ver la interfaz de monitoreo.

### Solución de problemas (Troubleshooting)

Si tiene problemas para iniciar, existe una solución de diagnóstico definitiva:
Paso 1: abra Claude Code en cualquier directorio;
Paso 2: dé a Claude Code la siguiente instrucción:
```
He instalado el paquete npm cc-viewer pero no puedo iniciarlo. Revisa cli.js y findcc.js de cc-viewer, y adapta la implementación local de Claude Code según el contexto actual. Intenta limitar el alcance de los cambios a findcc.js.
```
¡Dejar que Claude Code inspeccione los errores por sí mismo es más efectivo que preguntarle a cualquier persona o leer cualquier documentación!

Una vez completada la instrucción anterior, se actualizará findcc.js. Si su proyecto frecuentemente requiere despliegue local, o si el código bifurcado necesita resolver problemas de instalación con frecuencia, conserve este archivo para copiarlo directamente la próxima vez. En la actualidad, muchos proyectos y empresas que usan Claude Code no lo despliegan en Mac sino en servidores, por lo que el autor separó el archivo findcc.js para facilitar el seguimiento de las actualizaciones del código fuente de cc-viewer.

### Desinstalar

```bash
ccv --uninstall
```

### Verificar versión

```bash
ccv --version
```

## Características

### Monitoreo de solicitudes (modo texto original)
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- Captura en tiempo real de todas las solicitudes de API de Claude Code — texto original, no logs recortados (¡esto es importante!)
- Identifica y etiqueta automáticamente las solicitudes de Main Agent y Sub Agent (subtipos: Bash, Task, Plan, General)
- Las solicitudes MainAgent soportan Body Diff JSON, mostrando plegadas las diferencias con la solicitud MainAgent anterior (solo campos cambiados/añadidos)
- Estadísticas de uso de Token en línea por solicitud (tokens de entrada/salida, creación/lectura de caché, tasa de aciertos)
- Compatible con Claude Code Router (CCR) y otros escenarios de proxy — las solicitudes se detectan por patrón de ruta API como respaldo

### Modo conversación

Haga clic en el botón «Modo conversación» en la esquina superior derecha para analizar el historial completo de conversación del Main Agent como interfaz de chat:
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- Aún no se admite la visualización de Agent Teams
- Mensajes del usuario alineados a la derecha (burbujas azules), respuestas del Main Agent alineadas a la izquierda (burbujas oscuras)
- Los bloques `thinking` están colapsados por defecto, renderizados en Markdown, haga clic para expandir y ver el proceso de pensamiento; se admite traducción con un clic (función aún inestable)
- Los mensajes de selección del usuario (AskUserQuestion) se muestran en formato de pregunta y respuesta
- Sincronización bidireccional de modos: al cambiar al modo conversación se navega automáticamente a la conversación de la solicitud seleccionada; al volver al modo texto original se navega automáticamente a la solicitud seleccionada
- Panel de configuración: se puede alternar el estado de colapso predeterminado de los resultados de herramientas y los bloques de pensamiento


### Herramientas de estadísticas

Panel flotante «Estadísticas de datos» en el área del encabezado:
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- Muestra la cantidad de cache creation/read y la tasa de aciertos de caché
- Estadísticas de reconstrucción de caché: agrupadas por razón (TTL, cambio de system/tools/model, truncamiento/modificación de mensajes, cambio de key) mostrando cantidad y tokens de cache_creation
- Estadísticas de uso de herramientas: frecuencia de llamadas por herramienta, ordenadas por cantidad de llamadas
- Estadísticas de uso de Skills: frecuencia de llamadas por Skill, ordenadas por cantidad de llamadas
- Iconos de ayuda conceptual (?): haga clic para ver la documentación integrada de MainAgent, CacheRebuild y cada herramienta

### Gestión de logs

A través del menú desplegable de CC-Viewer en la esquina superior izquierda:
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

- Importar logs locales: explorar archivos de log históricos, agrupados por proyecto, se abre en nueva ventana
- Cargar archivo JSONL local: seleccionar y cargar directamente un archivo `.jsonl` local (hasta 500MB)
- Guardar log actual como: descargar el archivo de log JSONL de monitoreo actual
- Combinar logs: combinar múltiples archivos de log JSONL en una sola sesión para análisis unificado
- Ver Prompts del usuario: extraer y mostrar todas las entradas del usuario, con tres modos de vista — modo Original (contenido sin procesar), modo Contexto (etiquetas del sistema colapsables), modo Texto (texto plano); los comandos slash (`/model`, `/context`, etc.) se muestran como entradas independientes; las etiquetas relacionadas con comandos se ocultan automáticamente del contenido del Prompt
- Exportar Prompts como TXT: exportar los Prompts del usuario (texto plano, sin etiquetas del sistema) a un archivo `.txt` local

### Soporte multilingüe

CC-Viewer admite 18 idiomas y cambia automáticamente según el idioma del sistema:

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
