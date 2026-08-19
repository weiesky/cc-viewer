# CronCreate

Programa un prompt para que se ponga en cola en un momento futuro, ya sea de forma única o recurrente. Utiliza la sintaxis cron estándar de 5 campos en la zona horaria local del usuario, sin necesidad de conversión de zona horaria.

## Cuándo usar

- **Recordatorios de una sola vez**: Cuando el usuario quiere que se le recuerde en un momento específico ("recuérdame mañana a las 3 pm"). Con `recurring: false`, la tarea se elimina automáticamente tras ejecutarse.
- **Programas recurrentes**: Cuando algo debe ejecutarse repetidamente ("cada día laborable a las 9 am", "cada 30 minutos"). El valor predeterminado `recurring: true` cubre este caso.
- **Bucles de agente autónomo**: Para flujos de trabajo que necesitan re-activarse solos según un horario, como resúmenes diarios o comprobaciones de estado periódicas.
- **Tareas duraderas**: Cuando el programa debe sobrevivir a un reinicio de sesión. Con `durable: true`, la tarea se guarda en `.claude/scheduled_tasks.json`.
- **Solicitudes de hora aproximada**: Cuando el usuario dice "hacia las 9" u "hourly", se debe elegir un valor de minuto desplazado (p. ej. `57 8 * * *` o `7 * * * *`) para evitar que múltiples usuarios coincidan en :00 o :30.

## Parámetros

- `cron` (string, obligatorio): Expresión cron de 5 campos en la zona horaria local del usuario. Formato: `minuto hora día-del-mes mes día-de-la-semana`. Ejemplo: `"0 9 * * 1-5"` significa lunes a viernes a las 9:00.
- `prompt` (string, obligatorio): El texto del prompt que se pondrá en cola cuando el cron se dispare — el mensaje exacto que se enviará al REPL en el momento programado.
- `recurring` (boolean, opcional, predeterminado `true`): Con `true`, el trabajo se ejecuta en cada intervalo cron coincidente y expira automáticamente a los 7 días. Con `false`, el trabajo se ejecuta exactamente una vez y luego se elimina — para recordatorios de una sola vez.
- `durable` (boolean, opcional, predeterminado `false`): Con `false`, el programa vive solo en memoria y se pierde al terminar la sesión. Con `true`, la tarea se persiste en `.claude/scheduled_tasks.json` y sobrevive a los reinicios.

## Ejemplos

### Ejemplo 1: recordatorio de una sola vez

El usuario dice: "Recuérdame mañana a las 2:30 pm que envíe el informe semanal." Suponiendo que mañana es el 21 de abril:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Recordatorio: envía el informe semanal ahora.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` garantiza que la tarea se elimine tras ejecutarse. `durable: true` la mantiene ante cualquier reinicio previo.

### Ejemplo 2: tarea matutina recurrente en días laborables

El usuario dice: "Cada mañana de día laborable, resume mis issues abiertas en GitHub."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Resume todos los issues abiertos de GitHub asignados a mí.",
  "recurring": true,
  "durable": true
}
```

El minuto `3` en lugar de `0` evita el pico de carga a la hora en punto. El trabajo expira automáticamente a los 7 días.

## Notas

- **Expiración automática de 7 días**: Las tareas recurrentes se eliminan automáticamente tras 7 días como máximo. Si se necesita un programa más largo, recréalo antes de que expire.
- **Solo se ejecuta en reposo**: `CronCreate` encola el prompt únicamente cuando el REPL no está procesando otra consulta. Si el REPL está ocupado en el momento de disparo, el prompt espera hasta que finalice la consulta actual.
- **Evitar los minutos :00 y :30**: Para solicitudes de hora aproximada, elige deliberadamente valores de minuto desplazados para distribuir la carga del sistema. Reserva :00/:30 solo cuando el usuario especifique ese minuto exacto.
- **Sin conversión de zona horaria**: La expresión cron se interpreta directamente en la zona horaria local del usuario. No es necesario convertir a UTC ni a ninguna otra zona.
