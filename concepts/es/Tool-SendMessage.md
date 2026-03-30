# SendMessage

## Definición

Envía mensajes entre agentes dentro de un equipo. Se utiliza para comunicación directa, difusión y mensajes de protocolo (solicitudes/respuestas de apagado, aprobación de planes).

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `to` | string | Sí | Destinatario: nombre del compañero, o `"*"` para difundir a todos |
| `message` | string / object | Sí | Mensaje de texto o objeto de protocolo estructurado |
| `summary` | string | No | Vista previa de 5-10 palabras mostrada en la interfaz |

## Tipos de mensaje

### Texto plano
Mensajes directos entre compañeros de equipo para coordinación, actualizaciones de estado y discusiones sobre tareas.

### Solicitud de apagado
Solicita a un compañero que se apague de forma ordenada: `{ type: "shutdown_request", reason: "..." }`

### Respuesta de apagado
El compañero aprueba o rechaza el apagado: `{ type: "shutdown_response", approve: true/false }`

### Respuesta de aprobación de plan
Aprueba o rechaza el plan de un compañero: `{ type: "plan_approval_response", approve: true/false }`

## Difusión vs. Directo

- **Directo** (`to: "nombre-del-compañero"`): Enviar a un compañero específico — preferido para la mayoría de las comunicaciones
- **Difusión** (`to: "*"`): Enviar a todos los compañeros — usar con moderación, solo para anuncios críticos a nivel de equipo

## Herramientas relacionadas

| Herramienta | Propósito |
|-------------|-----------|
| `TeamCreate` | Crear un nuevo equipo |
| `TeamDelete` | Eliminar el equipo al finalizar |
| `Agent` | Generar compañeros de equipo que se unen al equipo |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Gestionar la lista de tareas compartida |
