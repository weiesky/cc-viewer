# NotebookEdit

## Definition

Replaces, inserts, or deletes specific cells in a Jupyter notebook (.ipynb file).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `notebook_path` | string | Yes | Absolute path of the notebook file |
| `new_source` | string | Yes | New content for the cell |
| `cell_id` | string | No | ID of the cell to edit. In insert mode, the new cell is inserted after this ID |
| `cell_type` | enum | No | Cell type: `code` or `markdown`. Required in insert mode |
| `edit_mode` | enum | No | Edit mode: `replace` (default), `insert`, `delete` |

## Use Cases

**Good for:**
- Modifying code or markdown cells in a Jupyter notebook
- Adding new cells to a notebook
- Deleting cells from a notebook

## Notes

- `cell_number` is 0-indexed
- `insert` mode inserts a new cell at the specified position
- `delete` mode deletes the cell at the specified position
- The path must be an absolute path

## Significance in cc-viewer

NotebookEdit calls appear in request logs as `tool_use` content blocks, recording the specific modification operations on the notebook.

## Original Text

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
