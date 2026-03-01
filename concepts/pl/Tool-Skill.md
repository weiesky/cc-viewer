# Skill

## Definicja

Wykonuje umiejętność (skill) w głównej rozmowie. Umiejętności to specjalizowane zdolności, które użytkownik może wywoływać za pomocą slash command (np. `/commit`, `/review-pr`).

## Parametry

| Parametr | Typ | Wymagany | Opis |
|------|------|------|------|
| `skill` | string | Tak | Nazwa umiejętności (np. "commit", "review-pr", "pdf") |
| `args` | string | Nie | Argumenty umiejętności |

## Scenariusze użycia

**Odpowiednie zastosowanie:**
- Użytkownik wpisał slash command w formacie `/<skill-name>`
- Żądanie użytkownika pasuje do funkcjonalności zarejestrowanej umiejętności

**Nieodpowiednie zastosowanie:**
- Wbudowane polecenia CLI (np. `/help`, `/clear`)
- Umiejętność już jest w trakcie wykonywania
- Nazwa umiejętności nie znajduje się na liście dostępnych umiejętności

## Uwagi

- Po wywołaniu umiejętność rozwija się w pełny prompt
- Obsługuje w pełni kwalifikowane nazwy (np. `ms-office-suite:pdf`)
- Lista dostępnych umiejętności jest podawana w wiadomościach system-reminder
- Gdy widoczny jest tag `<command-name>`, oznacza to, że umiejętność została załadowana — należy ją bezpośrednio wykonać, a nie ponownie wywoływać to narzędzie
- Nie wspominaj o umiejętności bez faktycznego wywołania narzędzia

## Znaczenie w cc-viewer

Wywołanie Skill w logach żądań pojawia się jako blok content `tool_use`. Prompt rozwinięty z umiejętności wpływa na system prompt lub zawartość wiadomości kolejnych żądań.

## Tekst oryginalny

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
