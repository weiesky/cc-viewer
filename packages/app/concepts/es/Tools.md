# Resumen de herramientas de Claude Code

Claude Code proporciona al modelo un conjunto de herramientas integradas a través del mecanismo tool_use de la API de Anthropic. Cada solicitud MainAgent incluye las definiciones completas en JSON Schema de estas herramientas en el array `tools`, y el modelo las invoca mediante content blocks `tool_use` en la respuesta.

A continuación se presenta el índice clasificado de todas las herramientas.

## Sistema de Agents

| Herramienta | Propósito |
|-------------|-----------|
| [Agent](Tool-Agent.md) | Iniciar un sub-agent (SubAgent) para manejar tareas complejas de múltiples pasos |
| [TaskOutput](Tool-TaskOutput.md) | Obtener la salida de tareas en segundo plano |
| [TaskStop](Tool-TaskStop.md) | Detener una tarea en segundo plano en ejecución |
| [TaskCreate](Tool-TaskCreate.md) | Crear una entrada en la lista de tareas estructurada |
| [TaskGet](Tool-TaskGet.md) | Obtener detalles de una tarea |
| [TaskUpdate](Tool-TaskUpdate.md) | Actualizar el estado, dependencias, etc. de una tarea |
| [TaskList](Tool-TaskList.md) | Listar todas las tareas |
| [ListAgents](Tool-ListAgents.md) | Listar los agents disponibles en la sesión |

## Team & Orquestación

| Herramienta | Propósito |
|-------------|-----------|
| [SendMessage](Tool-SendMessage.md) | Enviar un mensaje a otro agent |
| [Workflow](Tool-Workflow.md) | Ejecutar un script de orquestación multi-agent determinista |
| [Monitor](Tool-Monitor.md) | Transmitir eventos de un script de larga ejecución como notificaciones |
| [SendFile](Tool-SendFile.md) | Enviar archivos a otra sesión de Claude Code |
| [SendUserFile](Tool-SendUserFile.md) | Enviar archivos al usuario |
| [SendUserMessage](Tool-SendUserMessage.md) | Enviar un mensaje al usuario (herramienta Brief heredada) |
| [EndConversation](Tool-EndConversation.md) | Terminar la conversación actual |

## Operaciones de archivos

| Herramienta | Propósito |
|-------------|-----------|
| [Read](Tool-Read.md) | Leer contenido de archivos (soporta texto, imágenes, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | Editar archivos mediante reemplazo exacto de cadenas |
| [Write](Tool-Write.md) | Escribir o sobrescribir archivos |
| [NotebookEdit](Tool-NotebookEdit.md) | Editar celdas de Jupyter notebook |

## Búsqueda

| Herramienta | Propósito |
|-------------|-----------|
| [Glob](Tool-Glob.md) | Buscar archivos por coincidencia de patrones de nombre |
| [Grep](Tool-Grep.md) | Búsqueda de contenido de archivos basada en ripgrep |
| [ToolSearch](Tool-ToolSearch.md) | Buscar y cargar herramientas diferidas/MCP bajo demanda |

## Terminal

| Herramienta | Propósito |
|-------------|-----------|
| [Bash](Tool-Bash.md) | Ejecutar comandos shell |
| [REPL](Tool-REPL.md) | Ejecutar JavaScript en un REPL de Node.js persistente |

## Web

| Herramienta | Propósito |
|-------------|-----------|
| [WebFetch](Tool-WebFetch.md) | Obtener contenido web y procesarlo con IA |
| [WebSearch](Tool-WebSearch.md) | Consultas en motores de búsqueda |
| [Artifact](Tool-Artifact.md) | Publicar un archivo HTML/Markdown como página web alojada en claude.ai |
| [DesignSync](Tool-DesignSync.md) | Sincronizar una biblioteca de componentes local con un proyecto de design system de claude.ai |

## Planificación e interacción

| Herramienta | Propósito |
|-------------|-----------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Entrar en modo de planificación para diseñar un plan de implementación |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Salir del modo de planificación y enviar el plan para aprobación del usuario |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Hacer preguntas al usuario para obtener aclaraciones o decisiones |
| [ReportFindings](Tool-ReportFindings.md) | Reportar hallazgos de revisión de código como lista tipada para la UI anfitriona |
| [TodoWrite](Tool-TodoWrite.md) | Escribir una lista de tareas estructurada para la sesión |
| [SendFeedback](Tool-SendFeedback.md) | Enviar feedback estructurado sobre Claude Code a Anthropic |
| [Projects](Tool-Projects.md) | Gestionar documentos de la base de conocimiento del proyecto |
| [ProposeGoal](Tool-ProposeGoal.md) | Proponer una meta de finalización verificable para la sesión |

## Worktrees

| Herramienta | Propósito |
|-------------|-----------|
| [EnterWorktree](Tool-EnterWorktree.md) | Crear o entrar en un worktree git aislado para la sesión |
| [ExitWorktree](Tool-ExitWorktree.md) | Salir de la sesión worktree, manteniendo o eliminando |

## Planificación y Notificaciones

| Herramienta | Propósito |
|-------------|-----------|
| [CronCreate](Tool-CronCreate.md) | Programar una solicitud en una expresión cron (recurrente o única) |
| [CronDelete](Tool-CronDelete.md) | Cancelar un trabajo cron programado |
| [CronList](Tool-CronList.md) | Listar trabajos cron programados |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Auto-marcador de iteraciones /loop programando el siguiente despertar |
| [PushNotification](Tool-PushNotification.md) | Enviar notificación de escritorio/móvil al usuario |
| [RemoteTrigger](Tool-RemoteTrigger.md) | Gestionar rutinas de remote-trigger de claude.ai |
| [ReadNotifications](Tool-ReadNotifications.md) | Leer notificaciones pendientes de la sesión |

## Extensiones

| Herramienta | Propósito |
|-------------|-----------|
| [Skill](Tool-Skill.md) | Ejecutar una habilidad (slash command) |

## MCP y extensiones

| Herramienta | Propósito |
|-------------|-----------|
| [ListMcpResources](Tool-ListMcpResources.md) | Listar recursos expuestos por servidores MCP conectados |
| [ReadMcpResource](Tool-ReadMcpResource.md) | Leer un único recurso de un servidor MCP por URI |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | Listar un recurso MCP estilo directorio por URI |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | Buscar en el registro de conectores MCP por palabra clave |
| [SuggestConnectors](Tool-SuggestConnectors.md) | Resolver detalles de conectores a partir de resultados de búsqueda del registro |
| [ListConnectors](Tool-ListConnectors.md) | Listar conectores MCP instalados |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | Mostrar una tarjeta de instalación de plugin en línea |
| [SuggestSkills](Tool-SuggestSkills.md) | Mostrar una tarjeta de skills añadibles |
| [ListPlugins](Tool-ListPlugins.md) | Listar plugins de claude.ai habilitados |
| [ListSkills](Tool-ListSkills.md) | Listar skills de claude.ai habilitadas |

## Integración con IDE

| Herramienta | Propósito |
|-------------|-----------|
| [LSP](Tool-LSP.md) | Consultas de servidor de lenguaje (definiciones, referencias, símbolos) |
