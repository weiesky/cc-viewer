# ScheduleWakeup

Programa cuándo reanudar el trabajo en el modo dinámico `/loop`. La herramienta permite a Claude autogestionar el ritmo de las iteraciones de una tarea, durmiendo durante el intervalo elegido y luego disparándose nuevamente con el mismo prompt de bucle.

## Cuándo usar

- Al autogestionar el ritmo de una tarea dinámica `/loop` donde el intervalo de iteración depende del estado del trabajo en lugar de un reloj fijo
- Al esperar a que finalice una compilación larga, despliegue o ejecución de pruebas antes de revisar los resultados
- Al insertar ticks de inactividad entre iteraciones cuando no hay una señal específica que monitorear en este momento
- Al ejecutar un bucle autónomo sin prompt del usuario — pasar el centinela literal `<<autonomous-loop-dynamic>>` como `prompt`
- Al sondear un proceso cuyo estado está a punto de cambiar (usar un retraso corto para mantener el caché caliente)

## Activación

- No disponible en Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform ni Microsoft Foundry.
- También desactivado cuando la obtención de feature flags está deshabilitada (variables de entorno de telemetría/tráfico).

## Parámetros

- `delaySeconds` (número, requerido): Segundos hasta la reanudación. El tiempo de ejecución limita automáticamente el valor a `[60, 3600]`, por lo que no es necesario limitarlo manualmente.
- `reason` (cadena, requerido): Una frase corta que explica el retraso elegido. Se muestra al usuario y se registra en la telemetría. Sea específico — "verificando compilación larga de bun" es más útil que "esperando."
- `prompt` (cadena, requerido): La entrada `/loop` que se disparará al despertar. Pasar la misma cadena en cada turno para que el siguiente disparo repita la tarea. Para un bucle autónomo sin prompt del usuario, pasar el centinela literal `<<autonomous-loop-dynamic>>`.

## Ejemplos

### Ejemplo 1: retraso corto para volver a verificar una señal que cambia rápidamente (mantener caché caliente)

Una compilación acaba de iniciarse y normalmente termina en dos o tres minutos.

```json
{
  "delaySeconds": 120,
  "reason": "verificando compilación de bun que se espera termine en ~2 min",
  "prompt": "verificar estado de compilación y reportar cualquier error"
}
```

120 segundos mantiene el contexto de la conversación en el caché de prompts de Anthropic (TTL 5 min), por lo que el siguiente despertar es más rápido y económico.

### Ejemplo 2: tick de inactividad largo (aceptar fallo de caché, amortizar en una espera más larga)

Una migración de base de datos está en ejecución y normalmente tarda 20–40 minutos.

```json
{
  "delaySeconds": 1200,
  "reason": "la migración suele tardar 20–40 min; verificando en 20 min",
  "prompt": "verificar estado de migración y continuar si ha terminado"
}
```

El caché estará frío al despertar, pero la espera de 20 minutos amortiza más que suficientemente el único fallo de caché. Sondear cada 5 minutos pagaría el mismo costo de fallo 4 veces sin ningún beneficio.

## Notas

- **TTL de caché de 5 minutos**: El caché de prompts de Anthropic expira después de 300 segundos. Los retrasos por debajo de 300 s mantienen el contexto caliente; los retrasos por encima de 300 s incurren en un fallo de caché en el siguiente despertar.
- **Evitar exactamente 300 s**: Es lo peor de ambos mundos — se paga el fallo de caché sin obtener una espera significativamente más larga. Reducir a 270 s (mantener caché caliente) o comprometerse con 1200 s o más (un fallo compra una espera mucho más larga).
- **Valor predeterminado para ticks de inactividad**: Cuando no hay una señal específica que monitorear, usar **1200–1800 s** (20–30 min). Esto permite que el bucle verifique periódicamente sin quemar el caché 12 veces por hora sin razón.
- **Limitación automática**: El tiempo de ejecución limita `delaySeconds` a `[60, 3600]`. Los valores por debajo de 60 se convierten en 60; los valores por encima de 3600 se convierten en 3600. No es necesario gestionar estos límites manualmente.
- **Omitir la llamada para terminar el bucle**: Si se pretende detener las iteraciones, no llamar a ScheduleWakeup. Simplemente omitir la llamada termina el bucle.
- **Pasar el mismo `prompt` en cada turno**: El campo `prompt` debe llevar la instrucción `/loop` original en cada invocación para que el siguiente despertar sepa qué tarea reanudar.
