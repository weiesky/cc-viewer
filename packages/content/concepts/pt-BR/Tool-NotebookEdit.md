# NotebookEdit

Modifica uma única célula em um notebook Jupyter (`.ipynb`). Suporta substituir a fonte de uma célula, inserir uma nova célula ou excluir uma célula existente preservando o restante da estrutura do notebook.

## Quando usar

- Corrigir ou atualizar uma célula de código em um notebook de análise sem reescrever o arquivo inteiro
- Trocar uma célula markdown para melhorar a narrativa ou adicionar documentação
- Inserir uma nova célula de código ou markdown em uma posição conhecida em um notebook existente
- Remover uma célula obsoleta ou quebrada para que células a jusante não dependam mais dela
- Preparar um notebook reproduzível iterando em uma célula de cada vez

## Parâmetros

- `notebook_path` (string, obrigatório): Caminho absoluto para o arquivo `.ipynb`. Caminhos relativos são rejeitados.
- `new_source` (string, obrigatório): A nova fonte da célula. Para `replace` e `insert` torna-se o corpo da célula; para `delete` é ignorado, mas ainda exigido pelo schema.
- `cell_id` (string, opcional): ID da célula alvo. Nos modos `replace` e `delete`, a ferramenta age sobre essa célula. No modo `insert`, a nova célula é inserida imediatamente após a célula com este ID; omita para inserir no topo do notebook.
- `cell_type` (enum, opcional): Ou `code` ou `markdown`. Obrigatório quando `edit_mode` é `insert`. Quando omitido durante `replace`, o tipo da célula existente é preservado.
- `edit_mode` (enum, opcional): `replace` (padrão), `insert` ou `delete`.

## Exemplos

### Exemplo 1: Substituir uma célula de código com bug
Chame `NotebookEdit` com `notebook_path` definido como o caminho absoluto, `cell_id` definido como o ID da célula alvo e `new_source` contendo o código Python corrigido. Deixe `edit_mode` no padrão `replace`.

### Exemplo 2: Inserir uma explicação em markdown
Para adicionar uma célula markdown logo após uma célula `setup` existente, defina `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` como o ID da célula setup e coloque a narrativa em `new_source`.

### Exemplo 3: Excluir uma célula obsoleta
Defina `edit_mode: "delete"` e forneça o `cell_id` da célula a remover. Forneça qualquer string para `new_source`; ela não é aplicada.

## Observações

- Sempre passe um caminho absoluto. `NotebookEdit` não resolve caminhos relativos contra o diretório de trabalho.
- A ferramenta reescreve apenas a célula alvo; contagens de execução, outputs e metadados de células não relacionadas permanecem intocados.
- Inserir sem um `cell_id` coloca a nova célula no início do notebook.
- `cell_type` é obrigatório para inserts. Para replaces, omita a menos que você queira explicitamente converter uma célula de código em markdown ou vice-versa.
- Para inspecionar células e pegar seus IDs, use a ferramenta `Read` no notebook primeiro; ela retorna as células com seu conteúdo e outputs.
- Use o `Edit` regular para arquivos fonte comuns; `NotebookEdit` é específico para JSON de `.ipynb` e entende sua estrutura de células.
