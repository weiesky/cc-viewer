# NotebookEdit

Modifies a single cell in a Jupyter notebook (`.ipynb`). Supports replacing a cell's source, inserting a new cell, or deleting an existing cell while preserving the rest of the notebook structure.

## When to Use

- Fixing or updating a code cell in an analysis notebook without rewriting the entire file
- Swapping out a markdown cell to improve narrative or add documentation
- Inserting a new code or markdown cell at a known position in an existing notebook
- Removing an obsolete or broken cell so downstream cells no longer depend on it
- Preparing a reproducible notebook by iterating on cells one at a time

## Parameters

- `notebook_path` (string, required): Absolute path to the `.ipynb` file. Relative paths are rejected.
- `new_source` (string, required): The new cell source. For `replace` and `insert` it becomes the cell body; for `delete` it is ignored but still required by the schema.
- `cell_id` (string, optional): ID of the target cell. In `replace` and `delete` modes, the tool acts on this cell. In `insert` mode, the new cell is inserted immediately after the cell with this ID; omit it to insert at the top of the notebook.
- `cell_type` (enum, optional): Either `code` or `markdown`. Required when `edit_mode` is `insert`. When omitted during `replace`, the existing cell's type is preserved.
- `edit_mode` (enum, optional): `replace` (default), `insert`, or `delete`.

## Examples

### Example 1: Replace a buggy code cell
Call `NotebookEdit` with `notebook_path` set to the absolute path, `cell_id` set to the target cell's ID, and `new_source` containing the corrected Python code. Leave `edit_mode` at its default `replace`.

### Example 2: Insert a markdown explanation
To add a markdown cell right after an existing `setup` cell, set `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` to the setup cell's ID, and put the narrative in `new_source`.

### Example 3: Delete a stale cell
Set `edit_mode: "delete"` and supply the `cell_id` of the cell to remove. Provide any string for `new_source`; it is not applied.

## Notes

- Always pass an absolute path. `NotebookEdit` does not resolve relative paths against the working directory.
- The tool rewrites only the targeted cell; execution counts, outputs, and metadata for unrelated cells remain untouched.
- Inserting without a `cell_id` places the new cell at the very beginning of the notebook.
- `cell_type` is mandatory for inserts. For replaces, omit it unless you explicitly want to convert a code cell into markdown or vice versa.
- To inspect cells and grab their IDs, use the `Read` tool on the notebook first; it returns the cells with their content and outputs.
- Use regular `Edit` for plain source files; `NotebookEdit` is specific to `.ipynb` JSON and understands its cell structure.
