# AskUserQuestion

## Definition

Stellt dem Benutzer während der Ausführung Fragen, um Klärungen zu erhalten, Annahmen zu überprüfen oder Entscheidungen anzufordern.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `questions` | array | Ja | Fragenliste (1–4 Fragen) |
| `answers` | object | Nein | Vom Benutzer gesammelte Antworten |
| `annotations` | object | Nein | Anmerkungen zu jeder Frage (z.B. Hinweise zur Vorschauauswahl) |
| `metadata` | object | Nein | Metadaten für Tracking und Analyse |

Jedes `question`-Objekt:

| Feld | Typ | Erforderlich | Beschreibung |
|------|-----|--------------|--------------|
| `question` | string | Ja | Vollständiger Fragetext, sollte mit einem Fragezeichen enden |
| `header` | string | Ja | Kurzes Label (max. 12 Zeichen), wird als Label-Chip angezeigt |
| `options` | array | Ja | 2–4 Optionen |
| `multiSelect` | boolean | Ja | Ob Mehrfachauswahl erlaubt ist |

Jedes `option`-Objekt:

| Feld | Typ | Erforderlich | Beschreibung |
|------|-----|--------------|--------------|
| `label` | string | Ja | Anzeigetext der Option (1–5 Wörter) |
| `description` | string | Ja | Beschreibung der Option |
| `markdown` | string | Nein | Vorschauinhalt (für visuellen Vergleich von ASCII-Layouts, Code-Snippets usw.) |

## Anwendungsfälle

**Geeignet für:**
- Sammeln von Benutzerpräferenzen oder Anforderungen
- Klärung mehrdeutiger Anweisungen
- Einholen von Entscheidungen während der Implementierung
- Bereitstellung von Richtungsoptionen für den Benutzer

**Nicht geeignet für:**
- Fragen wie „Ist der Plan in Ordnung?" – dafür sollte ExitPlanMode verwendet werden

## Hinweise

- Der Benutzer kann immer "Other" wählen, um eine benutzerdefinierte Eingabe zu machen
- Die empfohlene Option steht an erster Stelle mit "(Recommended)" am Ende des Labels
- `markdown`-Vorschau wird nur bei Einzelauswahl-Fragen unterstützt
- Optionen mit `markdown` wechseln zu einem nebeneinander angeordneten Layout
- Im Planungsmodus wird es verwendet, um Anforderungen vor der Festlegung des Plans zu klären

## Bedeutung in cc-viewer

AskUserQuestion-Aufrufe erscheinen im Anfrage-Log als `tool_use` Content Block mit Fragen- und Optionsdefinitionen. Die Antworten des Benutzers erscheinen im Nachrichtenverlauf nachfolgender Anfragen.

## Originaltext

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
