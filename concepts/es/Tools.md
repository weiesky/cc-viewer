# Resumen de herramientas de Claude Code

Claude Code proporciona al modelo un conjunto de herramientas integradas a través del mecanismo tool_use de la API de Anthropic. Cada solicitud MainAgent incluye las definiciones completas en JSON Schema de estas herramientas en el array `tools`, y el modelo las invoca mediante content blocks `tool_use` en la respuesta.

A continuación se presenta el índice clasificado de todas las herramientas.

## Sistema de Agents

| Herramienta | Propósito |
|-------------|-----------|
| [Task](Tool-Task.md) | Iniciar un sub-agent (SubAgent) para manejar tareas complejas de múltiples pasos |
| [TaskOutput](Tool-TaskOutput.md) | Obtener la salida de tareas en segundo plano |
| [TaskStop](Tool-TaskStop.md) | Detener una tarea en segundo plano en ejecución |
| [TaskCreate](Tool-TaskCreate.md) | Crear una entrada en la lista de tareas estructurada |
| [TaskGet](Tool-TaskGet.md) | Obtener detalles de una tarea |
| [TaskUpdate](Tool-TaskUpdate.md) | Actualizar el estado, dependencias, etc. de una tarea |
| [TaskList](Tool-TaskList.md) | Listar todas las tareas |

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

## Terminal

| Herramienta | Propósito |
|-------------|-----------|
| [Bash](Tool-Bash.md) | Ejecutar comandos shell |

## Web

| Herramienta | Propósito |
|-------------|-----------|
| [WebFetch](Tool-WebFetch.md) | Obtener contenido web y procesarlo con IA |
| [WebSearch](Tool-WebSearch.md) | Consultas en motores de búsqueda |

## Planificación e interacción

| Herramienta | Propósito |
|-------------|-----------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Entrar en modo de planificación para diseñar un plan de implementación |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Salir del modo de planificación y enviar el plan para aprobación del usuario |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Hacer preguntas al usuario para obtener aclaraciones o decisiones |

## Extensiones

| Herramienta | Propósito |
|-------------|-----------|
| [Skill](Tool-Skill.md) | Ejecutar una habilidad (slash command) |

## Integración con IDE

| Herramienta | Propósito |
|-------------|-----------|
| [getDiagnostics](Tool-getDiagnostics.md) | Obtener información de diagnóstico del lenguaje de VS Code |
| [executeCode](Tool-executeCode.md) | Ejecutar código en el kernel de Jupyter |
