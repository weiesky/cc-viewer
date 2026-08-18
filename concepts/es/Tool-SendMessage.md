# SendMessage

Entrega un mensaje de un miembro del equipo a otro dentro de un equipo activo, o hace un broadcast a todos los compañeros a la vez. Este es el único canal que los compañeros pueden escuchar — cualquier cosa escrita en la salida de texto normal es invisible para ellos.

## Cuándo usar

- Asignar una tarea o delegar un subproblema a un compañero con nombre durante la colaboración en equipo.
- Solicitar estado, hallazgos intermedios o una revisión de código a otro agente.
- Hacer broadcast de una decisión, restricción compartida o anuncio de apagado a todo el equipo mediante `*`.
- Responder a un prompt de protocolo como una solicitud de apagado o una solicitud de aprobación de plan del líder del equipo.
- Cerrar el ciclo al final de una tarea delegada para que el líder pueda marcar el elemento como completo.

## Activación

- Restringida por las mismas condiciones de mensajería entre sesiones que `ListAgents` (feature flags del lado del servidor, desactivados por defecto).
- Los compañeros requieren además que los equipos de agentes experimentales estén habilitados.

## Parámetros

- `to` (string, obligatorio): El `name` del compañero objetivo según esté registrado en el equipo, o `*` para hacer broadcast a todos los compañeros a la vez.
- `message` (string u objeto, obligatorio): Texto plano para comunicación normal, o un objeto estructurado para respuestas de protocolo como `shutdown_response` y `plan_approval_response`.
- `summary` (string, opcional): Una vista previa de 5 a 10 palabras mostrada en el registro de actividad del equipo para mensajes de texto plano. Obligatorio para mensajes de cadena largos; se ignora cuando `message` es un objeto de protocolo.

## Ejemplos

### Ejemplo 1: Delegación directa de tarea

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Ejemplo 2: Broadcast de una restricción compartida

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Ejemplo 3: Respuesta de protocolo

Responde a una solicitud de apagado del líder usando un mensaje estructurado:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Ejemplo 4: Respuesta de aprobación de plan

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Notas

- Tu salida de texto regular del asistente NO se transmite a los compañeros. Si quieres que otro agente vea algo, debe pasar por `SendMessage`. Este es el error más común en los flujos de trabajo de equipo.
- El broadcast (`to: "*"`) es costoso — despierta a cada compañero y consume su contexto. Resérvalo para anuncios que realmente afecten a todos. Prefiere envíos dirigidos.
- Mantén los mensajes concisos y orientados a la acción. Incluye las rutas de archivos, restricciones y formato de respuesta esperado que el destinatario necesita; recuerda que no tienen memoria compartida contigo.
- Los objetos de mensaje de protocolo (`shutdown_response`, `plan_approval_response`) tienen formas fijas. No mezcles campos de protocolo en mensajes de texto plano ni viceversa.
- Los mensajes son asíncronos. El destinatario recibirá el tuyo en su próximo turno; no asumas que lo ha leído o actuado hasta que responda.
- Un `summary` bien escrito hace que el registro de actividad del equipo sea escaneable para el líder — trátalo como la línea de asunto de un commit.
