# AskUserQuestion

## Определение

Задаёт вопрос пользователю в процессе выполнения для получения уточнения, проверки предположений или запроса решения.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `questions` | array | Да | Список вопросов (1-4 вопроса) |
| `answers` | object | Нет | Собранные ответы пользователя |
| `annotations` | object | Нет | Аннотации к каждому вопросу (например, примечания к предпросмотру выбора) |
| `metadata` | object | Нет | Метаданные для отслеживания и анализа |

Каждый объект `question`:

| Поле | Тип | Обязательный | Описание |
|------|------|------|------|
| `question` | string | Да | Полный текст вопроса, должен заканчиваться вопросительным знаком |
| `header` | string | Да | Короткая метка (максимум 12 символов), отображается как чип метки |
| `options` | array | Да | 2-4 варианта |
| `multiSelect` | boolean | Да | Разрешён ли множественный выбор |

Каждый объект `option`:

| Поле | Тип | Обязательный | Описание |
|------|------|------|------|
| `label` | string | Да | Отображаемый текст варианта (1-5 слов) |
| `description` | string | Да | Описание варианта |
| `markdown` | string | Нет | Содержимое предпросмотра (для визуального сравнения ASCII-макетов, фрагментов кода и т.д.) |

## Сценарии использования

**Подходящее применение:**
- Сбор предпочтений или требований пользователя
- Уточнение неясных инструкций
- Получение решений в процессе реализации
- Предоставление пользователю выбора направления

**Неподходящее применение:**
- Вопрос «план подходит?» — следует использовать ExitPlanMode

## Примечания

- Пользователь всегда может выбрать "Other" и предоставить собственный ввод
- Рекомендуемый вариант должен быть первым, с "(Recommended)" в конце метки
- Предпросмотр `markdown` поддерживается только для вопросов с одиночным выбором
- Варианты с `markdown` переключаются на расположение бок о бок (лево-право)
- В режиме планирования используется для уточнения требований перед определением плана

## Значение в cc-viewer

Вызов AskUserQuestion в логах запросов отображается как блок content `tool_use`, содержащий определения вопросов и вариантов. Ответ пользователя появляется в истории сообщений последующих запросов.

## Оригинальный текст

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
