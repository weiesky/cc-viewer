# NotebookEdit

## Definición

Reemplaza, inserta o elimina celdas específicas en un Jupyter notebook (archivo .ipynb).

## Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `notebook_path` | string | Sí | Ruta absoluta del archivo notebook |
| `new_source` | string | Sí | Nuevo contenido de la celda |
| `cell_id` | string | No | ID de la celda a editar. En modo inserción, la nueva celda se inserta después de este ID |
| `cell_type` | enum | No | Tipo de celda: `code` o `markdown`. Requerido en modo inserción |
| `edit_mode` | enum | No | Modo de edición: `replace` (por defecto), `insert`, `delete` |

## Casos de uso

**Adecuado para:**
- Modificar celdas de código o markdown en Jupyter notebooks
- Agregar nuevas celdas a un notebook
- Eliminar celdas de un notebook

## Notas

- `cell_number` tiene índice base 0
- El modo `insert` inserta una nueva celda en la posición especificada
- El modo `delete` elimina la celda en la posición especificada
- La ruta debe ser absoluta

## Significado en cc-viewer

Las llamadas a NotebookEdit aparecen en el registro de solicitudes como content blocks `tool_use`, registrando las operaciones específicas de modificación del notebook.

## Texto original

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
