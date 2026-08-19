# ExitPlanMode

Envía el plan de implementación que se redactó durante el modo plan para su aprobación por el usuario y — si es aprobado — transiciona la sesión fuera del modo plan para que puedan comenzar las ediciones.

## Cuándo usar

- Un plan escrito durante `EnterPlanMode` está completo y listo para revisión.
- La tarea está orientada a implementación (cambios de código o configuración), no investigación pura, por lo que un plan explícito es apropiado.
- Toda la lectura y el análisis previos han sido realizados; no se necesita más investigación antes de que el usuario decida.
- El asistente ha enumerado rutas de archivos, funciones y pasos concretos — no solo objetivos.
- El usuario ha pedido ver el plan, o el flujo de modo plan está a punto de pasar el testigo a las herramientas de edición.

## Parámetros

- `allowedPrompts` (array, opcional): Prompts que el usuario puede escribir en la pantalla de aprobación para autoaprobar o alterar el plan. Cada elemento especifica un permiso con ámbito (por ejemplo, un nombre de operación y la herramienta a la que aplica). Déjalo sin establecer para usar el flujo de aprobación por defecto.

## Ejemplos

### Ejemplo 1: Envío estándar

Tras investigar un refactor de autenticación dentro del modo plan y escribir el archivo de plan en disco, el asistente llama a `ExitPlanMode` sin argumentos. El harness lee el plan desde su ubicación canónica, lo muestra al usuario y espera aprobación o rechazo.

### Ejemplo 2: Acciones rápidas preaprobadas

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Permite al usuario conceder permiso por adelantado para comandos de seguimiento rutinarios, para que el asistente no tenga que detenerse en cada solicitud de permiso durante la implementación.

## Notas

- `ExitPlanMode` solo tiene sentido para trabajo de tipo implementación. Si la solicitud del usuario es una tarea de investigación o explicación sin cambios de archivos, responde directamente en su lugar — no enrutes a través del modo plan solo para salir de él.
- El plan ya debe estar escrito en disco antes de llamar a esta herramienta. `ExitPlanMode` no acepta el cuerpo del plan como parámetro; lee desde la ruta que el harness espera.
- Si el usuario rechaza el plan, vuelves al modo plan. Revisa basándote en la retroalimentación y vuelve a enviar; no empieces a editar archivos mientras el plan no esté aprobado.
- La aprobación concede permiso para salir del modo plan y usar herramientas mutadoras (`Edit`, `Write`, `Bash`, etc.) para el ámbito descrito en el plan. Expandir el ámbito después requiere un nuevo plan o consentimiento explícito del usuario.
- No uses `AskUserQuestion` para preguntar "¿te parece bien este plan?" antes de llamar a esta herramienta — solicitar la aprobación del plan es exactamente lo que hace `ExitPlanMode`, y el usuario no puede ver el plan hasta que se envíe.
- Mantén el plan mínimo y accionable. Un revisor debería poder leerlo por encima en menos de un minuto y entender exactamente qué va a cambiar.
- Si te das cuenta a mitad de implementación de que el plan estaba equivocado, detente y reporta al usuario en lugar de desviarte silenciosamente. Volver a entrar al modo plan es un paso válido a continuación.
