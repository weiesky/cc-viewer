# AskUserQuestion

## Визначення

Використовується для запитань користувачу під час виконання з метою отримання уточнень, перевірки припущень або запиту рішень.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `questions` | array | Так | Список запитань (1-4 запитання) |
| `answers` | object | Ні | Зібрані відповіді користувача |
| `annotations` | object | Ні | Примітки до кожного запитання (наприклад, нотатки до попереднього перегляду вибору) |
| `metadata` | object | Ні | Метадані для відстеження та аналізу |

Кожен об'єкт `question`:

| Поле | Тип | Обов'язковий | Опис |
|------|-----|--------------|------|
| `question` | string | Так | Повний текст запитання, повинен закінчуватися знаком питання |
| `header` | string | Так | Короткий ярлик (максимум 12 символів), відображається як чіп-мітка |
| `options` | array | Так | 2-4 варіанти |
| `multiSelect` | boolean | Так | Чи дозволено множинний вибір |

Кожен об'єкт `option`:

| Поле | Тип | Обов'язковий | Опис |
|------|-----|--------------|------|
| `label` | string | Так | Текст відображення варіанту (1-5 слів) |
| `description` | string | Так | Опис варіанту |
| `markdown` | string | Ні | Вміст попереднього перегляду (для візуального порівняння ASCII-макетів, фрагментів коду тощо) |

## Сценарії використання

**Підходить для:**
- Збір уподобань або вимог користувача
- Уточнення нечітких інструкцій
- Прийняття рішень під час реалізації
- Надання користувачу вибору напрямку

**Не підходить для:**
- Запитання "Чи підходить план?" — слід використовувати ExitPlanMode

## Примітки

- Користувач завжди може вибрати "Other" для надання власного введення
- Рекомендований варіант розміщується першим, і в кінці label додається "(Recommended)"
- Попередній перегляд `markdown` підтримується лише для запитань з одиничним вибором
- Варіанти з `markdown` перемикаються на паралельний макет
- У режимі планування використовується для уточнення вимог перед визначенням плану

## Значення в cc-viewer

Виклик AskUserQuestion відображається в журналі запитів як `tool_use` content block, що містить визначення запитань та варіантів. Відповідь користувача з'являється в історії повідомлень наступних запитів.

## Оригінальний текст

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
