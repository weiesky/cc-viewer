# NotebookEdit

## Визначення

Замінює, вставляє або видаляє конкретну комірку в Jupyter notebook (файл .ipynb).

## Параметри

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|--------------|------|
| `notebook_path` | string | Так | Абсолютний шлях до файлу notebook |
| `new_source` | string | Так | Новий вміст комірки |
| `cell_id` | string | Ні | ID комірки для редагування. У режимі вставки нова комірка вставляється після цього ID |
| `cell_type` | enum | Ні | Тип комірки: `code` або `markdown`. Обов'язковий у режимі вставки |
| `edit_mode` | enum | Ні | Режим редагування: `replace` (за замовчуванням), `insert`, `delete` |

## Сценарії використання

**Підходить для:**
- Зміна коду або markdown комірок у Jupyter notebook
- Додавання нових комірок до notebook
- Видалення комірок з notebook

## Примітки

- `cell_number` має індексацію з 0
- Режим `insert` вставляє нову комірку у вказану позицію
- Режим `delete` видаляє комірку у вказаній позиції
- Шлях повинен бути абсолютним

## Значення в cc-viewer

Виклики NotebookEdit відображаються в журналі запитів як `tool_use` content block і фіксують конкретні операції зміни notebook.

## Оригінальний текст

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
