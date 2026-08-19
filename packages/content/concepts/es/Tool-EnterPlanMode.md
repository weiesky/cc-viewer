# EnterPlanMode

Cambia la sesión al modo plan, una fase de exploración de solo lectura en la que el asistente investiga el código y redacta un plan de implementación concreto para que el usuario lo apruebe antes de modificar archivo alguno.

## Cuándo usar

- El usuario solicita un cambio no trivial que abarca varios archivos o subsistemas.
- Los requisitos son ambiguos y el asistente necesita leer código antes de comprometerse con un enfoque.
- Se propone un refactor, migración o actualización de dependencia y el radio de impacto no está claro.
- El usuario dice explícitamente "planea esto", "primero hagamos un plan", o solicita una revisión de diseño.
- El riesgo es lo suficientemente alto como para que pasar directamente a editar pueda desperdiciar trabajo o dañar el estado.

## Parámetros

Ninguno. `EnterPlanMode` no recibe argumentos — invócalo con un objeto de parámetros vacío.

## Ejemplos

### Ejemplo 1: Solicitud de funcionalidad grande

El usuario pregunta: "Añade SSO mediante Okta al panel de administración." El asistente llama a `EnterPlanMode`, luego pasa varios turnos leyendo el middleware de autenticación, el almacenamiento de sesiones, los guardas de rutas y la interfaz de inicio de sesión existente. Escribe un plan que describe los cambios necesarios, los pasos de migración y la cobertura de pruebas, y lo envía mediante `ExitPlanMode` para su aprobación.

### Ejemplo 2: Refactor arriesgado

El usuario dice: "Convierte los controladores REST a tRPC." El asistente entra en modo plan, examina cada controlador, cataloga el contrato público, enumera las fases de despliegue (shim, lectura dual, cutover) y propone un plan de secuenciación antes de tocar ningún archivo.

## Notas

- El modo plan es de solo lectura por contrato. Estando dentro, el asistente no debe ejecutar `Edit`, `Write`, `NotebookEdit`, ni ningún comando de shell que mute estado. Usa únicamente `Read`, `Grep`, `Glob` y comandos `Bash` no destructivos.
- No entres en modo plan para ediciones triviales de una línea, preguntas de investigación pura o tareas donde el usuario ya haya especificado el cambio con todo detalle. La sobrecarga perjudica más que ayuda.
- Bajo el modo Auto, se desaconseja el modo plan salvo que el usuario lo solicite explícitamente — el modo Auto prefiere la acción sobre la planificación previa.
- Usa el modo plan para reducir correcciones de rumbo en trabajo costoso. Un plan de cinco minutos suele ahorrar una hora de ediciones mal orientadas.
- Una vez en modo plan, enfoca la investigación en las partes del sistema que realmente van a cambiar. Evita recorridos exhaustivos del repositorio sin relación con la tarea en curso.
- El plan en sí debe escribirse en disco en la ruta que el harness espera para que `ExitPlanMode` pueda enviarlo. El plan debe contener rutas de archivos concretas, nombres de funciones y pasos de verificación, no intenciones vagas.
- El usuario puede rechazar el plan y pedir revisiones. Itera dentro del modo plan hasta que el plan sea aceptado; solo entonces sal.
