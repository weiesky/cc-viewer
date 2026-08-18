# PushNotification

Envía una notificación de escritorio desde la sesión actual de Claude Code. Si Remote Control está conectado, también envía la notificación al teléfono del usuario, atrayendo su atención desde donde esté de vuelta a la sesión.

## Cuándo usar

- Una tarea de larga duración finalizó mientras el usuario probablemente no estaba en el terminal
- Una compilación, ejecución de pruebas o despliegue se completó y el resultado está listo para revisión
- Se alcanzó un punto de decisión que requiere la entrada del usuario antes de poder continuar
- Surgió un error o bloqueo que no se puede resolver de forma autónoma
- El usuario solicitó explícitamente ser notificado cuando una tarea o condición específica se cumpla

## Cuándo no usar

No envíe una notificación para actualizaciones de progreso rutinarias durante una tarea, ni para confirmar que respondió algo que el usuario claramente acaba de preguntar y está esperando. No notifique cuando una tarea corta finaliza — si el usuario la acaba de enviar y está esperando, la notificación no aporta valor y erosiona la confianza en notificaciones futuras. Incline fuertemente hacia no enviarla.

## Activación

- Desactivado por defecto (feature flag del lado del servidor).
- La entrega se realiza a través de infraestructura alojada por Anthropic — no disponible en Amazon Bedrock, Claude Platform on AWS, Google Cloud ni Microsoft Foundry.
- El push al teléfono requiere además un cliente de Remote Control conectado.

## Parámetros

- `message` (cadena, obligatorio): el cuerpo de la notificación. Mantenga menos de 200 caracteres; los sistemas operativos móviles truncan cadenas más largas. Comience con lo que el usuario tomaría como acción: "build failed: 2 auth tests" es más útil que "task complete".
- `status` (cadena, obligatorio): siempre establecer en `"proactive"`. Es un marcador fijo y no cambia.

## Ejemplos

### Ejemplo 1: notificar al completar un análisis largo

Se solicitó una auditoría de dependencias de todo el repositorio que tardó varios minutos. El usuario se alejó. Cuando el informe está listo:

```
message: "Auditoría de dependencias lista: 3 CVEs de alta gravedad en lodash, axios, jsonwebtoken. Informe: audit-report.txt"
status: "proactive"
```

### Ejemplo 2: marcar un punto de decisión durante trabajo autónomo

Durante una refactorización de varios pasos, se descubre que dos módulos tienen interfaces en conflicto y no pueden fusionarse sin una decisión de diseño:

```
message: "Refactorización pausada: AuthService y UserService tienen interfaces de token en conflicto. Se necesita su decisión para continuar."
status: "proactive"
```

## Notas

- Incline hacia **no** enviar. La notificación interrumpe al usuario sin importar lo que esté haciendo. Trátela como un costo que debe justificarse con el valor de la información.
- Comience con contenido procesable. Las primeras palabras deben indicar qué ocurrió y qué, si acaso, debe hacer el usuario — no una etiqueta de estado genérica.
- Mantenga `message` bajo 200 caracteres. Los sistemas operativos móviles truncarán cadenas más largas, cortando la parte más importante si aparece al final.
- Si el resultado indica que el push no fue enviado porque Remote Control no está conectado, ese es el comportamiento esperado. No se necesita reintento ni acción adicional; la notificación de escritorio local sigue disparándose.
- Evite el spam de notificaciones. Si envía notificaciones frecuentemente por eventos menores, el usuario empezará a ignorarlas. Reserve esta herramienta para momentos en que haya una probabilidad real de que el usuario se haya alejado y quiera saber el resultado ahora.
