# TaskGet

Busca o registro completo de uma única tarefa por ID, incluindo sua descrição, status atual, owner, metadata e arestas de dependência. Use quando o resumo retornado por `TaskList` não for suficiente para agir sobre a tarefa.

## Quando usar

- Você pegou uma tarefa de `TaskList` e precisa da descrição completa antes de começar a trabalhar.
- Você está prestes a marcar uma tarefa como `completed` e quer reverificar os critérios de aceitação.
- Você precisa inspecionar quais tarefas esta `blocks` ou é `blockedBy` para decidir o próximo passo.
- Você está investigando histórico — quem é o owner, que metadata foi anexada, quando mudou de estado.
- Um colega ou sessão anterior referenciou um ID de tarefa e você precisa do contexto.

Prefira `TaskList` quando só precisa de uma varredura de alto nível; reserve `TaskGet` para o registro específico que você pretende ler com cuidado ou modificar.

## Ativação

- Disponível por padrão na maioria dos modelos.
- Não disponível no Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famílias posteriores (v2.1.233+) a menos que seja habilitado via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Todo o sistema de tarefas é desativado quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parâmetros

- `taskId` (string, obrigatório): O identificador da tarefa retornado por `TaskCreate` ou `TaskList`. IDs são estáveis durante toda a vida da tarefa.

## Exemplos

### Exemplo 1

Consultar uma tarefa que você acabou de ver na lista.

```
TaskGet(taskId: "t_01HXYZ...")
```

Campos típicos na resposta: `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Exemplo 2

Resolver dependências antes de começar.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Observações

- `TaskGet` é somente leitura e seguro para chamar repetidamente; não altera status ou ownership.
- Se `blockedBy` não estiver vazio e contém tarefas que não estão `completed`, não comece esta tarefa — resolva os bloqueadores primeiro (ou coordene com o owner deles).
- O campo `description` pode ser longo. Leia-o completamente antes de agir; passar os olhos leva a critérios de aceitação perdidos.
- Um `taskId` desconhecido ou excluído retorna um erro. Rode `TaskList` novamente para pegar um ID atual.
- Se você está prestes a editar uma tarefa, chame `TaskGet` primeiro para evitar sobrescrever campos que um colega acabou de alterar.
