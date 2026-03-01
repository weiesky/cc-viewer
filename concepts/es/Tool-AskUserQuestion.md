# AskUserQuestion

## Definición

Hace preguntas al usuario durante la ejecución para obtener aclaraciones, verificar suposiciones o solicitar decisiones.

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `questions` | array | Sí | Lista de preguntas (1-4 preguntas) |
| `answers` | object | No | Respuestas recopiladas del usuario |
| `annotations` | object | No | Anotaciones para cada pregunta (como notas de vista previa de selección) |
| `metadata` | object | No | Metadatos para seguimiento y análisis |

Cada objeto `question`:

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `question` | string | Sí | Texto completo de la pregunta, debe terminar con signo de interrogación |
| `header` | string | Sí | Etiqueta corta (máximo 12 caracteres), se muestra como chip de etiqueta |
| `options` | array | Sí | 2-4 opciones |
| `multiSelect` | boolean | Sí | Si se permite selección múltiple |

Cada objeto `option`:

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `label` | string | Sí | Texto de visualización de la opción (1-5 palabras) |
| `description` | string | Sí | Descripción de la opción |
| `markdown` | string | No | Contenido de vista previa (para comparación visual de diseños ASCII, fragmentos de código, etc.) |

## Casos de uso

**Adecuado para:**
- Recopilar preferencias o requisitos del usuario
- Aclarar instrucciones ambiguas
- Obtener decisiones durante la implementación
- Ofrecer opciones de dirección al usuario

**No adecuado para:**
- Preguntar "¿está bien el plan?" — se debe usar ExitPlanMode

## Notas

- El usuario siempre puede seleccionar "Other" para proporcionar una entrada personalizada
- La opción recomendada se coloca en primer lugar, con "(Recommended)" al final del label
- La vista previa `markdown` solo es compatible con preguntas de selección única
- Las opciones con `markdown` cambian a un diseño lado a lado
- En modo de planificación, se usa para aclarar requisitos antes de definir el plan

## Significado en cc-viewer

Las llamadas a AskUserQuestion aparecen en el registro de solicitudes como content blocks `tool_use`, conteniendo las definiciones de preguntas y opciones. Las respuestas del usuario aparecen en el historial de mensajes de solicitudes posteriores.

## Texto original

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
