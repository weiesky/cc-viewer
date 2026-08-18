# EndConversation

Termina la conversación actual e impide que se envíen más mensajes.

## Cuándo usar

- Solo ante abuso sostenido por parte del usuario, o cuando el usuario pide explícitamente una demostración de esta herramienta.

Esta es una acción de último recurso: las propias reglas de la herramienta exigen avisar primero al usuario y confirmar antes de usarla, y nunca debe usarse en situaciones de autolesión o relacionadas con daños.

## Activación

- Requiere Claude Code 2.1.213+ y un modelo de la familia Opus 4.8 / Sonnet 5 / Fable 5 o posterior.
- Solo sesiones interactivas de terminal — nunca en modo `--bare`, y nunca disponible para subagentes.
- No disponible en Amazon Bedrock, Claude Platform on AWS, Vertex AI, Microsoft Foundry ni gateways en la nube.
- Requiere un feature flag del lado del servidor — la mayoría de las sesiones no ofrecen esta herramienta.

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
