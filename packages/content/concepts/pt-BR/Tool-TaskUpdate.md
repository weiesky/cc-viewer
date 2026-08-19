# TaskUpdate

Modifica uma tarefa existente — seu status, conteúdo, ownership, metadata ou arestas de dependência. É assim que tarefas progridem em seu ciclo de vida e como o trabalho é repassado entre Claude Code, colegas de equipe e subagentes.

## Quando usar

- Transicionar uma tarefa pelo fluxo de status à medida que você trabalha nela.
- Reivindicar uma tarefa atribuindo-se (ou outro agente) como `owner`.
- Refinar o `subject` ou `description` quando aprender mais sobre o problema.
- Registrar dependências recém-descobertas com `addBlocks` / `addBlockedBy`.
- Anexar `metadata` estruturada como IDs de tickets externos ou dicas de prioridade.

## Ativação

- Disponível por padrão na maioria dos modelos.
- Não disponível no Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famílias posteriores (v2.1.233+) a menos que seja habilitado via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Todo o sistema de tarefas é desativado quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parâmetros

- `taskId` (string, obrigatório): A tarefa a modificar. Obtenha de `TaskList` ou `TaskCreate`.
- `status` (string, opcional): Um de `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, opcional): Título imperativo de substituição.
- `description` (string, opcional): Descrição detalhada de substituição.
- `activeForm` (string, opcional): Texto de spinner em gerúndio de substituição.
- `owner` (string, opcional): Handle do agente ou colega assumindo responsabilidade pela tarefa.
- `metadata` (object, opcional): Chaves de metadata a mesclar na tarefa. Defina uma chave como `null` para excluí-la.
- `addBlocks` (array of strings, opcional): IDs de tarefas que esta tarefa bloqueia.
- `addBlockedBy` (array of strings, opcional): IDs de tarefas que devem ser concluídas antes desta.

## Fluxo de status

O ciclo de vida é deliberadamente linear: `pending` → `in_progress` → `completed`. `deleted` é terminal e usado para retratar tarefas que nunca serão trabalhadas.

- Defina `in_progress` no momento em que você realmente começar o trabalho, não antes. Apenas uma tarefa por vez deve estar `in_progress` para um determinado owner.
- Defina `completed` apenas quando o trabalho estiver totalmente concluído — critérios de aceitação atendidos, testes passando, saída gravada. Se um bloqueio surgir, mantenha a tarefa `in_progress` e adicione uma nova tarefa descrevendo o que precisa ser resolvido.
- Nunca marque uma tarefa como `completed` quando testes estão falhando, a implementação está parcial ou você atingiu erros não resolvidos.
- Use `deleted` para tarefas que são canceladas ou duplicadas; não reaproveite uma tarefa para trabalho não relacionado.

## Exemplos

### Exemplo 1

Reivindicar uma tarefa e começá-la.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Exemplo 2

Finalizar o trabalho e registrar uma dependência de acompanhamento.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Observações

- `metadata` mescla chave por chave; passar `null` para uma chave a remove. Chame `TaskGet` primeiro se não tiver certeza do conteúdo atual.
- `addBlocks` e `addBlockedBy` anexam arestas; não removem as existentes. Editar o grafo destrutivamente requer um workflow dedicado — consulte o owner da equipe antes de reescrever dependências.
- Mantenha `activeForm` em sincronia quando alterar `subject` para que o texto do spinner continue lendo naturalmente.
- Não marque uma tarefa como `completed` para silenciá-la. Se o usuário cancelou o trabalho, use `deleted` com uma breve justificativa em `description`.
- Leia o último estado de uma tarefa com `TaskGet` antes de atualizar — colegas podem tê-la alterado entre sua última leitura e sua escrita.
