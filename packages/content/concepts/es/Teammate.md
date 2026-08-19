# Teammate

## Definicion

Un Teammate es un agente colaborativo en el modo de equipo de Claude Code Agent. Cuando el agente principal crea un equipo mediante `TeamCreate` y genera teammates usando la herramienta `Agent`, cada teammate se ejecuta como un proceso de agente independiente con su propia ventana de contexto y conjunto de herramientas, comunicandose con los miembros del equipo a traves de `SendMessage`.

## Diferencias con SubAgent

| Caracteristica | Teammate | SubAgent |
|----------------|----------|----------|
| Ciclo de vida | Persistente, puede recibir multiples mensajes | Tarea unica, se destruye al completarse |
| Comunicacion | Mensajeria bidireccional con SendMessage | Llamada unidireccional padre→hijo, devuelve resultado |
| Contexto | Contexto completo independiente, se conserva entre turnos | Contexto de tarea aislado |
| Colaboracion | Colaboracion en equipo, pueden comunicarse entre si | Estructura jerarquica, solo interactua con el agente padre |
| Tipo de tarea | Tareas complejas de multiples pasos | Tareas individuales como busqueda y exploracion |

## Comportamiento

- Creado por el agente principal (team lead) mediante la herramienta `Agent` y asignado a un `team_name`
- Comparte listas de tareas a traves de `TaskList` / `TaskGet` / `TaskUpdate`
- Entra en estado idle despues de cada turno, esperando ser activado por un nuevo mensaje
- Puede ser terminado de forma elegante mediante `shutdown_request`

## Descripcion del panel de estadisticas

El panel de estadisticas de Teammate muestra el numero de llamadas API de cada teammate. La columna `Name` muestra el nombre del teammate (por ejemplo, `reviewer-security`, `reviewer-pipeline`), y la columna `Count` muestra el numero total de solicitudes API generadas por ese teammate.
