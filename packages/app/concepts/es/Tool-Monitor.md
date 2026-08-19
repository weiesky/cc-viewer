# Monitor

Inicia un monitor en segundo plano que transmite eventos desde un script de larga ejecución. Cada línea de la salida estándar se convierte en una notificación — sigue trabajando mientras los eventos llegan al chat.

## Cuándo usar

- Seguir errores, advertencias o firmas de fallos en un archivo de registro mientras se ejecuta un despliegue
- Sondear una API remota, un PR o un pipeline de CI cada 30 segundos para detectar nuevos eventos de estado
- Vigilar cambios en un directorio del sistema de archivos o en la salida de compilación en tiempo real
- Esperar una condición específica a lo largo de muchas iteraciones (por ejemplo, un hito de paso de entrenamiento o el vaciado de una cola)
- **No** para un simple "esperar hasta que termine" — usar `Bash` con `run_in_background` para eso; emite una notificación de finalización cuando el proceso termina

## Activación

- Desactivado por defecto (feature flag del lado del servidor).
- No disponible en Amazon Bedrock, Google Cloud ni Microsoft Foundry.
- Desactivado cuando `DISABLE_TELEMETRY` o `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` está establecido.
- La fuente WebSocket requiere Claude Code 2.1.195+.

## Parámetros

- `command` (cadena, obligatorio): El comando de shell o script a ejecutar. Cada línea escrita en la salida estándar se convierte en un evento de notificación independiente. El monitor termina cuando el proceso sale.
- `description` (cadena, obligatorio): Una etiqueta corta y legible que se muestra en cada notificación. Ser específico — "errores en deploy.log" es mejor que "viendo logs". Esta etiqueta identifica qué monitor se activó.
- `timeout_ms` (número, predeterminado `300000`, máx `3600000`): Plazo de terminación forzada en milisegundos. Después de esta duración el proceso se termina. Se ignora cuando `persistent: true`.
- `persistent` (booleano, predeterminado `false`): Cuando es `true`, el monitor se ejecuta durante toda la sesión sin tiempo de espera. Detenerlo explícitamente con `TaskStop`.

## Ejemplos

### Ejemplo 1: Seguir un archivo de registro en busca de errores y fallos

Este ejemplo cubre todos los estados terminales: marcador de éxito, traceback, palabras clave de error comunes, terminación por OOM y salida inesperada del proceso.

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

Usar `grep --line-buffered` en cada tubería. Sin él, el sistema operativo almacena en búfer la salida en bloques de 4 KB y los eventos pueden retrasarse minutos. El patrón de alternancia cubre tanto la ruta de éxito (`deployed`) como las rutas de fallo (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`). Un monitor que solo observa el marcador de éxito permanece silencioso durante un fallo — el silencio es idéntico a "aún en ejecución".

### Ejemplo 2: Sondear una API remota cada 30 segundos

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` evita que un fallo de red transitorio finalice el bucle. Los intervalos de sondeo de 30 segundos o más son apropiados para las APIs remotas para evitar límites de tasa. Ajustar el patrón de grep para capturar tanto las respuestas de éxito como las de error, de modo que los errores del lado de la API no queden enmascarados por el silencio.

## Notas

- **Usar siempre `grep --line-buffered` en tuberías.** Sin él, el búfer de la tubería retrasa los eventos minutos porque el sistema operativo acumula la salida hasta llenar un bloque de 4 KB. `--line-buffered` fuerza un vaciado después de cada línea.
- **El filtro debe cubrir tanto las firmas de éxito como las de fallo.** Un monitor que solo observa el marcador de éxito permanece silencioso ante un fallo, un cuelgue o una salida inesperada. Ampliar la alternancia: incluir `Error`, `Traceback`, `FAILED`, `Killed`, `OOM` y marcadores de estado terminal similares junto a la palabra clave de éxito.
- **Intervalos de sondeo: 30 segundos o más para APIs remotas.** El sondeo frecuente de servicios externos arriesga errores de límite de tasa o bloqueos. Para verificaciones locales de sistema de archivos o procesos, 0,5–1 segundo es apropiado.
- **Usar `persistent: true` para monitores de toda la sesión.** El `timeout_ms` predeterminado de 300.000 ms (5 minutos) termina el proceso. Para monitores que deben ejecutarse hasta ser detenidos explícitamente, establecer `persistent: true` y llamar a `TaskStop` cuando se termine.
- **Parada automática ante inundación de eventos.** Cada línea de la salida estándar es un mensaje de conversación. Si el filtro es demasiado amplio y produce demasiados eventos, el monitor se detiene automáticamente. Reiniciar con un patrón `grep` más estricto. Las líneas que llegan en 200 ms se agrupan en una sola notificación.
