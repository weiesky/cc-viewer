# NotebookEdit

## Definição

Substitui, insere ou exclui células específicas em um Jupyter notebook (arquivo .ipynb).

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `notebook_path` | string | Sim | Caminho absoluto do arquivo notebook |
| `new_source` | string | Sim | Novo conteúdo da célula |
| `cell_id` | string | Não | ID da célula a editar. No modo de inserção, a nova célula é inserida após este ID |
| `cell_type` | enum | Não | Tipo de célula: `code` ou `markdown`. Obrigatório no modo de inserção |
| `edit_mode` | enum | Não | Modo de edição: `replace` (padrão), `insert`, `delete` |

## Cenários de Uso

**Adequado para:**
- Modificar células de código ou markdown em Jupyter notebooks
- Adicionar novas células ao notebook
- Excluir células do notebook

## Observações

- `cell_number` é indexado a partir de 0
- O modo `insert` insere uma nova célula na posição especificada
- O modo `delete` exclui a célula na posição especificada
- O caminho deve ser absoluto

## Significado no cc-viewer

A chamada NotebookEdit aparece nos logs de requisição como um content block `tool_use`, registrando a operação específica de modificação no notebook.

## Texto original

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
