# TaskStop

Detiene una tarea en segundo plano en ejecución — un comando de shell, un agente despachado o una sesión remota — por su handle en tiempo de ejecución. Úsala para liberar recursos, cancelar trabajo que ya no es útil o recuperarte cuando una tarea está atascada.

## Cuándo usar

- Un comando de shell en segundo plano ha estado corriendo más de lo esperado y ya no necesitas su resultado.
- Un agente local está en bucle o estancado y necesita ser interrumpido.
- El usuario cambió de dirección y el trabajo en segundo plano para la dirección anterior debería abandonarse.
- Una sesión remota está a punto de expirar o está reteniendo un recurso que necesitas.
- Necesitas una pizarra limpia antes de iniciar una nueva ejecución de la misma tarea.

Prefiere dejar que el trabajo en segundo plano de corta duración termine por sí solo. `TaskStop` es para casos donde continuar la ejecución no tiene valor o es activamente dañino.

## Parámetros

- `task_id` (string, obligatorio): El handle en tiempo de ejecución devuelto cuando se inició la tarea en segundo plano. Es el mismo identificador aceptado por `TaskOutput`, no un `taskId` de lista de tareas.

## Ejemplos

### Ejemplo 1

Detener un comando de shell en segundo plano descontrolado.

```
TaskStop(task_id: "bash_01HXYZ...")
```

El comando recibe una señal de terminación; la salida almacenada en el buffer hasta ahora sigue siendo legible en su ruta de salida.

### Ejemplo 2

Cancelar un agente despachado tras una corrección de rumbo del usuario.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Notas

- `TaskStop` solicita terminación; no garantiza apagado instantáneo. Las tareas bien comportadas salen con prontitud, pero un proceso haciendo E/S bloqueante puede tardar un momento en desenredarse.
- Detener una tarea no elimina su salida. Para tareas de shell en segundo plano, el archivo de salida en disco se preserva y sigue siendo legible con `Read`. Para agentes y sesiones, cualquier salida capturada antes de la detención sigue siendo accesible vía `TaskOutput`.
- Un `task_id` desconocido, o una tarea que ya ha terminado, devuelve un error o un no-op. Es seguro — puedes llamar a `TaskStop` defensivamente sin comprobar el estado primero.
- Si pretendes reiniciar el mismo trabajo, detén la tarea vieja antes de despachar la nueva para evitar que dos ejecuciones paralelas compitan por recursos compartidos (archivos, puertos, filas de base de datos).
- `TaskStop` no afecta a las entradas de la lista de tareas del equipo. Para cancelar una tarea rastreada, actualiza su estado a `deleted` con `TaskUpdate`.
