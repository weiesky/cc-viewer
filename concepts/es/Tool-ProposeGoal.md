# ProposeGoal

Propone una meta de finalización verificable para la sesión. La meta se muestra al usuario en un diálogo de aprobación (por defecto) y, una vez establecida, guía el resto de la conversación hacia un resultado comprobable.

## Cuándo usar

- La sesión tiene un estado final concreto que un evaluador podría verificar desde la conversación (p. ej. "all tests in test/auth pass").
- Quieres la aprobación explícita del usuario sobre qué significa "hecho" antes de hacer trabajo sustancial.
- Las propias palabras del usuario ya expresaron el resultado y quieres registrarlo como la meta de la sesión.

## Parámetros

- `condition` (string, obligatorio): La condición de finalización, escrita de modo que un evaluador separado pueda verificarla desde la conversación (p. ej. "all tests in test/auth pass (bun test exits 0)"). Máximo 500 caracteres — el usuario debe poder leer la condición completa en el diálogo de aprobación.
- `ask_user` (boolean, opcional): Si preguntar al usuario su aprobación antes de establecer la meta. Por defecto true (se muestra un diálogo de aprobación). Ponlo en false SOLO cuando las propias palabras del usuario en esta conversación expresaron este resultado como lo que quiere; la meta se establece entonces directamente con un aviso visible, y el usuario puede limpiarla con `/goal clear`.

## Ejemplos

### Ejemplo 1: Proponer una meta respaldada por tests

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

El usuario ve la condición en un diálogo de aprobación y puede aceptarla, editarla o rechazarla.

### Ejemplo 2: Adoptar directamente el resultado expresado por el usuario

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Solo válido porque el usuario expresó explícitamente ese resultado antes en la conversación.

## Notas

- Mantén `condition` corta y objetivamente comprobable — metas vagas ("make it better") frustran el propósito.
- `ask_user=false` está estrictamente limitado a resultados que el propio usuario expresó; cualquier otra cosa debe pasar por el diálogo de aprobación.
