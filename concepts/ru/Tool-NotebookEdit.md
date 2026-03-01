# NotebookEdit

## Определение

Заменяет, вставляет или удаляет определённую ячейку в Jupyter notebook (файл .ipynb).

## Параметры

| Параметр | Тип | Обязательный | Описание |
|------|------|------|------|
| `notebook_path` | string | Да | Абсолютный путь к файлу notebook |
| `new_source` | string | Да | Новое содержимое ячейки |
| `cell_id` | string | Нет | ID ячейки для редактирования. В режиме вставки новая ячейка вставляется после этого ID |
| `cell_type` | enum | Нет | Тип ячейки: `code` или `markdown`. Обязателен в режиме вставки |
| `edit_mode` | enum | Нет | Режим редактирования: `replace` (по умолчанию), `insert`, `delete` |

## Сценарии использования

**Подходящее применение:**
- Модификация ячеек кода или markdown в Jupyter notebook
- Добавление новых ячеек в notebook
- Удаление ячеек из notebook

## Примечания

- `cell_number` индексируется с 0
- Режим `insert` вставляет новую ячейку в указанную позицию
- Режим `delete` удаляет ячейку в указанной позиции
- Путь должен быть абсолютным

## Значение в cc-viewer

Вызов NotebookEdit в логах запросов отображается как блок content `tool_use`, фиксирующий конкретные операции модификации notebook.

## Оригинальный текст

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
