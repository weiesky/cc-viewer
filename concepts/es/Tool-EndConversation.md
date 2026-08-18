# EndConversation

Termina la conversación actual e impide que se envíen más mensajes.

## Cuándo usar

- Solo ante abuso sostenido por parte del usuario, o cuando el usuario pide explícitamente una demostración de esta herramienta.

Esta es una acción de último recurso: las propias reglas de la herramienta exigen avisar primero al usuario y confirmar antes de usarla, y nunca debe usarse en situaciones de autolesión o relacionadas con daños.

## Parámetros

Esta herramienta no toma parámetros.

## Ejemplos

### Ejemplo 1: Terminar la conversación

```
EndConversation()
```

El flujo tiene dos pasos: la primera llamada devuelve un mensaje de reflexión; una segunda llamada inmediatamente después termina de verdad la conversación (`ended: true`).

## Notas

- Fuertemente restringida: requiere un modelo compatible, el punto de entrada del CLI y un feature flag del lado del servidor — la mayoría de las sesiones no ofrecen esta herramienta.
- Una vez terminada, no se pueden enviar más mensajes en la conversación.
