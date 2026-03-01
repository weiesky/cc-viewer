# executeCode (mcp__ide__executeCode)

## Определение

Выполняет код Python в ядре Jupyter текущего файла notebook.

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `code` | string | Да | Код Python для выполнения |

## Сценарии использования

**Подходящее применение:**
- Выполнение кода в среде Jupyter notebook
- Тестирование фрагментов кода
- Анализ данных и вычисления

**Неподходящее применение:**
- Выполнение кода вне среды Jupyter — следует использовать Bash
- Модификация файлов — следует использовать Edit или Write

## Примечания

- Это инструмент MCP (Model Context Protocol), предоставляемый интеграцией с IDE
- Код выполняется в текущем ядре Jupyter, состояние сохраняется между вызовами
- Если пользователь явно не просит, следует избегать объявления переменных или изменения состояния ядра
- После перезапуска ядра состояние теряется

## Значение в cc-viewer

executeCode — это инструмент MCP, появляющийся в массиве `tools` логов запросов под именем `mcp__ide__executeCode`. Его вызовы и возвраты следуют стандартному шаблону `tool_use` / `tool_result`. Добавление/удаление инструментов MCP вызывает изменение массива tools, что может привести к пересборке кеша.

## Оригинальный текст

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
