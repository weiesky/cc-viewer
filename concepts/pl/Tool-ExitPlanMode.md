# ExitPlanMode

## Definicja

Wychodzi z trybu planowania i przesyła plan do zatwierdzenia przez użytkownika. Treść planu jest odczytywana z wcześniej zapisanego pliku planu.

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `allowedPrompts` | array | Nie | Lista opisów uprawnień wymaganych do wdrożenia planu |

Każdy element tablicy `allowedPrompts`:

| Pole | Typ | Wymagany | Opis |
|------|------|------|------|
| `tool` | enum | Tak | Odpowiednie narzędzie, obecnie obsługiwane tylko `Bash` |
| `prompt` | string | Tak | Semantyczny opis operacji (np. "run tests", "install dependencies") |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Plan w trybie planowania jest ukończony, gotowy do przesłania do zatwierdzenia przez użytkownika
- Tylko dla zadań wdrożeniowych wymagających pisania kodu

**Nieodpowiednie zastosowanie:**
- Czyste zadania badawcze/eksploracyjne — nie wymagają wyjścia z trybu planowania
- Chcesz zapytać użytkownika „czy plan jest OK?" — to właśnie funkcja tego narzędzia, nie używaj AskUserQuestion do tego

## Uwagi

- To narzędzie nie przyjmuje treści planu jako parametru — odczytuje ją z wcześniej zapisanego pliku planu
- Użytkownik zobaczy zawartość pliku planu do zatwierdzenia
- Nie pytaj za pomocą AskUserQuestion „czy plan jest OK" przed wywołaniem tego narzędzia — to byłoby duplikowanie
- Nie wspominaj o „planie" w pytaniach, ponieważ użytkownik nie widzi treści planu przed ExitPlanMode

## Znaczenie w cc-viewer

Wywołanie ExitPlanMode oznacza koniec fazy planowania. W logach żądań, żądania po tym wywołaniu zazwyczaj przechodzą do operacji wdrożeniowych (Edit, Write, Bash itp.).

## Tekst oryginalny

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
