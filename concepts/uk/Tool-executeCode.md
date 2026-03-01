# executeCode (mcp__ide__executeCode)

## Визначення

Виконує Python-код у Jupyter kernel поточного файлу notebook.

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `code` | string | Так | Python-код для виконання |

## Сценарії використання

**Підходить для:**
- Виконання коду в середовищі Jupyter notebook
- Тестування фрагментів коду
- Аналіз даних та обчислення

**Не підходить для:**
- Виконання коду поза середовищем Jupyter — слід використовувати Bash
- Зміна файлів — слід використовувати Edit або Write

## Примітки

- Це MCP (Model Context Protocol) інструмент, наданий інтеграцією з IDE
- Код виконується в поточному Jupyter kernel, стан зберігається між викликами
- Якщо користувач явно не просить, уникайте оголошення змінних або зміни стану kernel
- Після перезапуску kernel стан втрачається

## Значення в cc-viewer

executeCode — це MCP-інструмент, який з'являється в масиві `tools` журналу запитів під назвою `mcp__ide__executeCode`. Його виклики та повернення відповідають стандартному шаблону `tool_use` / `tool_result`. Додавання або видалення MCP-інструментів призводить до зміни масиву tools, що може спричинити перебудову кешу.

## Оригінальний текст

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
