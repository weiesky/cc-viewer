# RemoteTrigger

Llama a la API de activadores remotos de claude.ai para gestionar la ejecución de tareas programadas y bajo demanda. El token OAuth se gestiona internamente por la herramienta y nunca se expone al modelo ni al shell.

## Cuándo usar

- Gestionar agentes remotos (activadores) en claude.ai, incluyendo listar, inspeccionar y actualizar los existentes
- Crear una nueva tarea automatizada basada en cron que ejecute un agente de Claude según un calendario recurrente
- Ejecutar un activador existente bajo demanda sin esperar a su próxima ejecución programada
- Listar o auditar todos los activadores actuales para revisar su configuración y estado
- Actualizar la configuración de un activador, como el calendario, la carga útil o la descripción, sin necesidad de recrearlo

## Activación

- Requiere un plan Pro, Max, Team o Enterprise de claude.ai.
- No disponible en Amazon Bedrock, Claude Platform on AWS, Google Cloud ni Microsoft Foundry.
- Requiere feature flags del lado del servidor y los ajustes de política `allow_remote_sessions` / `allow_routines`.
- No es para las propias sesiones remotas.

## Parámetros

- `action` (string, requerido): la operación a realizar — uno de `list`, `get`, `create`, `update` o `run`
- `trigger_id` (string, requerido para `get`, `update` y `run`): el identificador del activador sobre el que operar; debe coincidir con el patrón `^[\w-]+$` (solo caracteres de palabra y guiones)
- `body` (object, requerido para `create` y `update`; opcional para `run`): la carga útil de la solicitud enviada a la API

## Ejemplos

### Ejemplo 1: listar todos los activadores

```json
{
  "action": "list"
}
```

Llama a `GET /v1/code/triggers` y devuelve un array JSON con todos los activadores asociados a la cuenta autenticada.

### Ejemplo 2: crear un nuevo activador que se ejecute cada mañana de día laborable

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Generar un resumen diario cada día laborable a las 08:00 UTC"
  }
}
```

Llama a `POST /v1/code/triggers` con el cuerpo proporcionado y devuelve el objeto del activador recién creado, incluyendo su `trigger_id` asignado.

### Ejemplo 3: ejecutar un activador bajo demanda

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Llama inmediatamente a `POST /v1/code/triggers/my-report-trigger/run`, omitiendo la hora programada.

### Ejemplo 4: obtener un activador individual

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Llama a `GET /v1/code/triggers/my-report-trigger` y devuelve la configuración completa del activador.

## Notas

- El token OAuth es inyectado en proceso por la herramienta — nunca copie, pegue ni registre tokens manualmente; hacerlo crea un riesgo de seguridad y es innecesario cuando se utiliza esta herramienta.
- Prefiera esta herramienta sobre `curl` puro u otros clientes HTTP para todas las llamadas a la API de activadores; el uso directo de HTTP omite la inyección segura del token y puede exponer credenciales.
- La herramienta devuelve la respuesta JSON sin procesar de la API; el llamador es responsable de analizar la respuesta y gestionar los códigos de estado de error.
- El valor de `trigger_id` debe coincidir con el patrón `^[\w-]+$` — solo se permiten caracteres alfanuméricos, guiones bajos y guiones; los espacios o caracteres especiales harán que la solicitud falle.
