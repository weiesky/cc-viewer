# TaskList

Retorna toda tarefa na equipe atual (ou sessão) em forma resumida. Use-o para examinar o trabalho pendente, decidir o que pegar a seguir e evitar criar duplicatas.

## Quando usar

- No início de uma sessão para ver o que já está rastreado.
- Antes de chamar `TaskCreate`, para confirmar que o trabalho ainda não foi capturado.
- Ao decidir qual tarefa reivindicar a seguir como colega de equipe ou subagente.
- Para verificar relações de dependência em toda a equipe de relance.
- Periodicamente durante sessões longas para ressincronizar com colegas de equipe que podem ter reivindicado, concluído ou adicionado tarefas.

`TaskList` é somente leitura e barato; chame-o livremente sempre que precisar de um panorama.

## Ativação

- Disponível por padrão na maioria dos modelos.
- Não disponível no Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famílias posteriores (v2.1.233+) a menos que seja habilitado via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Todo o sistema de tarefas é desativado quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parâmetros

`TaskList` não recebe parâmetros. Ele sempre retorna o conjunto completo de tarefas para o contexto ativo.

## Formato da resposta

Cada tarefa na lista é um resumo, não o registro completo. Espere aproximadamente:

- `id` — identificador estável para uso com `TaskGet` / `TaskUpdate`.
- `subject` — título curto imperativo.
- `status` — um de `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — handle do agente ou colega, ou vazio quando não reivindicado.
- `blockedBy` — array de IDs de tarefa que precisam completar primeiro.

Para a descrição completa, critérios de aceitação ou metadata de uma tarefa específica, continue com `TaskGet`.

## Exemplos

### Exemplo 1

Verificação rápida de status.

```
TaskList()
```

Examine a saída em busca de qualquer coisa `in_progress` sem `owner` (trabalho parado) e qualquer coisa `pending` com `blockedBy` vazio (pronta para pegar).

### Exemplo 2

Colega escolhendo a próxima tarefa.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Observações

- Heurística de colega: quando várias tarefas `pending` estão desbloqueadas e sem owner, escolha o ID mais baixo. Isso mantém o trabalho em FIFO e evita que dois agentes peguem a mesma tarefa de alto perfil.
- Respeite `blockedBy`: não comece uma tarefa cujos bloqueadores ainda estão `pending` ou `in_progress`. Trabalhe o bloqueador primeiro ou coordene com seu owner.
- `TaskList` é o único mecanismo de descoberta de tarefas. Não há busca; se a lista for longa, examine estruturalmente (por status, depois por owner).
- Tarefas excluídas ainda podem aparecer na lista com status `deleted` para rastreabilidade. Ignore-as para fins de planejamento.
- A lista reflete o estado vivo da equipe, então colegas podem adicionar ou reivindicar tarefas entre chamadas. Liste novamente antes de reivindicar se tempo passou.
