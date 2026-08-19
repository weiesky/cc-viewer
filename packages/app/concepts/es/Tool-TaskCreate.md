# TaskCreate

Crea una nueva tarea en la lista de tareas del equipo actual (o la lista de tareas de la sesión cuando no hay equipo activo). Úsala para capturar elementos de trabajo que deban ser rastreados, delegados o revisados más tarde.

## Cuándo usar

- El usuario describe un trabajo de varios pasos que se beneficia de un seguimiento explícito.
- Estás dividiendo una solicitud grande en unidades más pequeñas completables por separado.
- Se descubre un seguimiento a mitad de tarea y no debe olvidarse.
- Necesitas un registro duradero de intención antes de entregar trabajo a un compañero o subagente.
- Estás operando en modo plan y quieres que cada paso del plan esté representado como una tarea concreta.

Omite `TaskCreate` para acciones triviales de un solo paso, conversación pura o cualquier cosa completable en dos o tres llamadas directas de herramientas.

## Activación

- Disponible por defecto en la mayoría de los modelos.
- No disponible en las familias Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 y posteriores (v2.1.233+) salvo que se active explícitamente mediante `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` o `--tools`.
- Todo el sistema de tareas se desactiva cuando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parámetros

- `subject` (string, obligatorio): Título corto en imperativo, p. ej. `Fix login redirect on Safari`. Mantenlo en torno a ochenta caracteres o menos.
- `description` (string, obligatorio): Contexto detallado — el problema, las restricciones, los criterios de aceptación y cualquier archivo o enlace que un lector futuro necesite. Escribe como si un compañero fuera a retomar esto en frío.
- `activeForm` (string, opcional): Texto del indicador en presente continuo mostrado mientras la tarea está `in_progress`, p. ej. `Fixing login redirect on Safari`. Refleja el `subject` pero en forma -ing/-ndo.
- `metadata` (object, opcional): Datos estructurados arbitrarios adjuntos a la tarea. Usos comunes: etiquetas, pistas de prioridad, IDs de tickets externos o configuración específica del agente.

Las tareas recién creadas siempre comienzan con estado `pending` y sin propietario. Las dependencias (`blocks`, `blockedBy`) no se establecen en el momento de creación — aplícalas después con `TaskUpdate`.

## Ejemplos

### Ejemplo 1

Capturar un reporte de bug que el usuario acaba de enviar.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Ejemplo 2

Dividir un épico en unidades rastreadas al inicio de una sesión.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Notas

- Escribe el `subject` en voz imperativa y el `activeForm` en presente continuo para que la interfaz se lea con naturalidad cuando la tarea transicione a `in_progress`.
- Llama a `TaskList` antes de crear para evitar duplicados — la lista del equipo se comparte con compañeros y subagentes.
- No incluyas secretos o credenciales en `description` o `metadata`; los registros de tareas son visibles para cualquiera con acceso al equipo.
- Tras la creación, mueve la tarea a través de su ciclo de vida con `TaskUpdate`. No dejes trabajo abandonado silenciosamente en `in_progress`.
