# AskUserQuestion

## Definicja

Zadaje pytanie użytkownikowi podczas wykonywania, w celu uzyskania wyjaśnienia, weryfikacji założeń lub uzyskania decyzji.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `questions` | array | Tak | Lista pytań (1-4 pytania) |
| `answers` | object | Nie | Odpowiedzi zebrane od użytkownika |
| `annotations` | object | Nie | Adnotacje do każdego pytania (np. uwagi do podglądu wyboru) |
| `metadata` | object | Nie | Metadane do śledzenia i analizy |

Każdy obiekt `question`:

| Pole | Typ | Wymagany | Opis |
|------|------|------|------|
| `question` | string | Tak | Pełny tekst pytania, powinien kończyć się znakiem zapytania |
| `header` | string | Tak | Krótka etykieta (maks. 12 znaków), wyświetlana jako chip etykiety |
| `options` | array | Tak | 2-4 opcje |
| `multiSelect` | boolean | Tak | Czy dozwolony jest wielokrotny wybór |

Każdy obiekt `option`:

| Pole | Typ | Wymagany | Opis |
|------|------|------|------|
| `label` | string | Tak | Tekst wyświetlany opcji (1-5 słów) |
| `description` | string | Tak | Opis opcji |
| `markdown` | string | Nie | Zawartość podglądu (do wizualnego porównania układów ASCII, fragmentów kodu itp.) |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Zbieranie preferencji lub wymagań użytkownika
- Wyjaśnianie niejasnych instrukcji
- Uzyskiwanie decyzji podczas wdrażania
- Oferowanie użytkownikowi wyboru kierunku

**Nieodpowiednie zastosowanie:**
- Pytanie „czy plan jest OK?" — należy użyć ExitPlanMode

## Uwagi

- Użytkownik zawsze może wybrać "Other" i podać własne dane wejściowe
- Rekomendowana opcja powinna być na pierwszym miejscu, z "(Recommended)" na końcu etykiety
- Podgląd `markdown` jest obsługiwany tylko dla pytań jednokrotnego wyboru
- Opcje z `markdown` przełączają się na układ obok siebie (lewo-prawo)
- W trybie planowania służy do wyjaśniania wymagań przed ustaleniem planu

## Znaczenie w cc-viewer

Wywołanie AskUserQuestion w logach żądań pojawia się jako blok content `tool_use`, zawierający definicje pytań i opcji. Odpowiedź użytkownika pojawia się w historii wiadomości kolejnych żądań.

## Tekst oryginalny

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
