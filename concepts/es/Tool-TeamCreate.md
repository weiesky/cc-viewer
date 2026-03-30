# TeamCreate

## Definición

Crea un nuevo equipo para coordinar múltiples agentes trabajando en un proyecto. Los equipos permiten la ejecución paralela de tareas mediante una lista de tareas compartida y mensajería entre agentes.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `team_name` | string | Sí | Nombre para el nuevo equipo |
| `description` | string | No | Descripción / propósito del equipo |
| `agent_type` | string | No | Tipo / rol del líder del equipo |

## Qué crea

- **Archivo de configuración del equipo**: `~/.claude/teams/{team-name}/config.json` — almacena la lista de miembros y metadatos
- **Directorio de lista de tareas**: `~/.claude/tasks/{team-name}/` — lista de tareas compartida para todos los compañeros de equipo

Los equipos tienen una correspondencia 1:1 con las listas de tareas.

## Flujo de trabajo del equipo

1. **TeamCreate** — crear el equipo y su lista de tareas
2. **TaskCreate** — definir tareas para el equipo
3. **Agent** (con `team_name` + `name`) — generar compañeros de equipo que se unen al equipo
4. **TaskUpdate** — asignar tareas a los compañeros mediante `owner`
5. Los compañeros trabajan en las tareas y se comunican mediante **SendMessage**
6. Detener a los compañeros al terminar, luego **TeamDelete** para limpiar

## Herramientas relacionadas

| Herramienta | Propósito |
|-------------|-----------|
| `TeamDelete` | Eliminar el equipo y los directorios de tareas |
| `SendMessage` | Comunicación entre agentes dentro del equipo |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gestionar la lista de tareas compartida |
| `Agent` | Generar compañeros de equipo que se unen al equipo |
