# AskUserQuestion

Presenta al usuario una o varias preguntas estructuradas de opción múltiple dentro de la interfaz de chat, recoge sus selecciones y las devuelve al asistente — útil para desambiguar la intención sin un intercambio libre.

## Cuándo usar

- Una solicitud tiene varias interpretaciones razonables y el asistente necesita que el usuario elija una antes de continuar.
- El usuario debe elegir entre opciones concretas (framework, librería, ruta de archivo, estrategia) donde las respuestas en texto libre serían propensas a errores.
- Quieres comparar alternativas lado a lado usando el panel de vista previa.
- Varias decisiones relacionadas se pueden agrupar en una sola solicitud para reducir el ida y vuelta.
- Un plan o llamada de herramienta depende de configuración que el usuario aún no ha especificado.

## Parámetros

- `questions` (array, obligatorio): De una a cuatro preguntas mostradas juntas en una sola solicitud. Cada objeto de pregunta contiene:
  - `question` (string, obligatorio): El texto completo de la pregunta, terminado con signo de interrogación.
  - `header` (string, obligatorio): Una etiqueta corta (máximo 12 caracteres) renderizada como un chip sobre la pregunta.
  - `options` (array, obligatorio): De dos a cuatro objetos de opción. Cada opción tiene una `label` (de 1 a 5 palabras), una `description` y una vista previa `markdown` opcional.
  - `multiSelect` (boolean, obligatorio): Cuando es `true`, el usuario puede elegir más de una opción.

## Ejemplos

### Ejemplo 1: Elegir un solo framework

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Ejemplo 2: Vista previa lado a lado de dos diseños

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Notas

- La interfaz añade automáticamente una opción de texto libre "Other" a cada pregunta. No agregues tus propias entradas "Other", "None" o "Custom" — duplicarán la vía de escape integrada.
- Limita cada llamada a entre una y cuatro preguntas, y cada pregunta a entre dos y cuatro opciones. Exceder estos límites es rechazado por el harness.
- Si recomiendas una opción específica, colócala primero y añade "(Recommended)" a su etiqueta para que la interfaz resalte el camino preferido.
- Las vistas previas mediante el campo `markdown` solo se admiten en preguntas de selección única. Úsalas para artefactos visuales como diseños ASCII, fragmentos de código o diffs de configuración — no para preguntas de preferencia simples donde basta una etiqueta más una descripción.
- Cuando cualquier opción de una pregunta tiene un valor `markdown`, la interfaz cambia a un diseño lado a lado con la lista de opciones a la izquierda y la vista previa a la derecha.
- No uses `AskUserQuestion` para preguntar "¿te parece bien este plan?" — llama a `ExitPlanMode` en su lugar, que existe precisamente para la aprobación del plan. En modo plan, también evita mencionar "el plan" en el texto de la pregunta, porque el plan no es visible para el usuario hasta que se ejecuta `ExitPlanMode`.
- No uses esta herramienta para solicitar entrada sensible o de texto libre como claves de API o contraseñas. Pregunta en el chat en su lugar.
