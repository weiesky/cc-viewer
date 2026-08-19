# TodoWrite

Escreve uma lista de tarefas estruturada para a sessão atual, substituindo a lista anterior. Cada item carrega seu texto, um status e uma forma no presente contínuo exibida em indicadores de progresso.

## Quando usar

- Uma tarefa tem várias etapas distintas e rastreá-las ajuda você (e o usuário) a ver o progresso.
- O usuário pede explicitamente por uma lista de tarefas.
- Você quer marcar exatamente um item como em andamento enquanto o restante permanece pendente ou concluído.

## Ativação

- Ferramenta legada: desativada por padrão em sessões que oferecem as ferramentas de tarefa (`TaskCreate`, `TaskUpdate`, `TaskList`).
- Reative-a com `CLAUDE_CODE_ENABLE_TASKS=0`.

## Parâmetros

- `todos` (array, obrigatório): A lista de tarefas completa e atualizada. Cada entrada tem:
  - `content` (string): A descrição da tarefa.
  - `status` (string): Um de `pending`, `in_progress`, `completed`.
  - `activeForm` (string): Texto no presente contínuo exibido enquanto o item está em andamento (por exemplo, "Running tests").

## Exemplos

### Exemplo 1: Rastrear uma mudança em três etapas

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

A lista inteira é reescrita a cada chamada — sempre inclua todos os itens, não apenas os que mudaram.

## Observações

- A lista é substituída por completo a cada chamada; para atualizar um item, reenvie todos os itens com o novo status.
- Mantenha exatamente um item `in_progress` por vez.
- Em sessões onde as ferramentas de tarefa estruturada (`TaskCreate`/`TaskUpdate`/`TaskList`) estão habilitadas, o harness pode oferecer essas em vez de `TodoWrite` — prefira o conjunto de ferramentas anunciado.
