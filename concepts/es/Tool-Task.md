# Task

> **Nota:** En las versiones más recientes de Claude Code, esta herramienta ha sido renombrada a **Agent**. Consulte el documento [Tool-Agent](Tool-Agent).

## Definición

Inicia un sub-agent (SubAgent) para manejar de forma autónoma tareas complejas de múltiples pasos. Los sub-agents son subprocesos independientes, cada uno con su propio conjunto de herramientas y contexto dedicados.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `prompt` | string | Sí | Descripción de la tarea a ejecutar por el sub-agent |
| `description` | string | Sí | Resumen breve de 3-5 palabras |
| `subagent_type` | string | Sí | Tipo de sub-agent, determina el conjunto de herramientas disponibles |
| `model` | enum | No | Especificar modelo (sonnet / opus / haiku), por defecto hereda del padre |
| `max_turns` | integer | No | Número máximo de turnos agénticos |
| `run_in_background` | boolean | No | Si se ejecuta en segundo plano; las tareas en segundo plano devuelven la ruta del output_file |
| `resume` | string | No | ID del agent a reanudar, continúa desde la última ejecución |
| `isolation` | enum | No | Modo de aislamiento, `worktree` crea un git worktree temporal |

## Tipos de sub-agent

| Tipo | Propósito | Herramientas disponibles |
|------|-----------|--------------------------|
| `Bash` | Ejecución de comandos, operaciones git | Bash |
| `general-purpose` | Tareas generales de múltiples pasos | Todas las herramientas |
| `Explore` | Exploración rápida de la base de código | Todas las herramientas excepto Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Diseñar planes de implementación | Todas las herramientas excepto Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Preguntas y respuestas sobre la guía de uso de Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configurar la barra de estado | Read, Edit |

## Casos de uso

**Adecuado para:**
- Tareas complejas que requieren completarse de forma autónoma en múltiples pasos
- Exploración de la base de código e investigación profunda (usar tipo Explore)
- Trabajo paralelo que necesita entornos aislados
- Tareas de larga duración que necesitan ejecutarse en segundo plano

**No adecuado para:**
- Leer rutas de archivos específicas — usar directamente Read o Glob
- Buscar en 2-3 archivos conocidos — usar directamente Read
- Buscar definiciones de clases específicas — usar directamente Glob

## Notas

- El sub-agent devuelve un solo mensaje al completarse, sus resultados no son visibles para el usuario y el agent principal necesita transmitirlos
- Se pueden lanzar múltiples llamadas Task en paralelo en un solo mensaje para mejorar la eficiencia
- Las tareas en segundo plano verifican el progreso mediante la herramienta TaskOutput
- El tipo Explore es más lento que llamar directamente a Glob/Grep, usar solo cuando la búsqueda simple no es suficiente
