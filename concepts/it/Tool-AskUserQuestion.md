# AskUserQuestion

## Definizione

Pone domande all'utente durante l'esecuzione, per ottenere chiarimenti, verificare ipotesi o richiedere decisioni.

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `questions` | array | Sì | Lista di domande (1-4 domande) |
| `answers` | object | No | Risposte raccolte dall'utente |
| `annotations` | object | No | Annotazioni per ogni domanda (es. note per l'anteprima delle selezioni) |
| `metadata` | object | No | Metadati per tracciamento e analisi |

Ogni oggetto `question`:

| Campo | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `question` | string | Sì | Testo completo della domanda, deve terminare con un punto interrogativo |
| `header` | string | Sì | Etichetta breve (massimo 12 caratteri), visualizzata come chip |
| `options` | array | Sì | 2-4 opzioni |
| `multiSelect` | boolean | Sì | Se è consentita la selezione multipla |

Ogni oggetto `option`:

| Campo | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `label` | string | Sì | Testo visualizzato dell'opzione (1-5 parole) |
| `description` | string | Sì | Descrizione dell'opzione |
| `markdown` | string | No | Contenuto di anteprima (per il confronto visivo di layout ASCII, frammenti di codice, ecc.) |

## Scenari d'uso

**Adatto per:**
- Raccogliere preferenze o requisiti dell'utente
- Chiarire istruzioni ambigue
- Ottenere decisioni durante l'implementazione
- Offrire all'utente scelte di direzione

**Non adatto per:**
- Chiedere "il piano va bene?" — usare ExitPlanMode

## Note

- L'utente può sempre selezionare "Other" per fornire un input personalizzato
- L'opzione consigliata va messa per prima, con "(Recommended)" alla fine della label
- L'anteprima `markdown` è supportata solo per domande a selezione singola
- Le opzioni con `markdown` passano a un layout affiancato
- In modalità pianificazione, viene usato per chiarire i requisiti prima di definire il piano

## Significato in cc-viewer

La chiamata AskUserQuestion appare nei log delle richieste come content block `tool_use`, contenente la definizione delle domande e delle opzioni. Le risposte dell'utente compaiono nella cronologia dei messaggi delle richieste successive.

## Testo originale

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
