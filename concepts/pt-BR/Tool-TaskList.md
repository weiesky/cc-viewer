# TaskList

## Definição

Lista todas as tarefas na lista de tarefas, para visualizar o progresso geral e trabalho disponível.

## Parâmetros

Sem parâmetros.

## Conteúdo Retornado

Informações resumidas de cada tarefa:
- `id` — Identificador da tarefa
- `subject` — Descrição curta
- `status` — Status: `pending`, `in_progress` ou `completed`
- `owner` — Responsável (ID do agent), vazio indica não atribuído
- `blockedBy` — Lista de IDs de tarefas não concluídas que bloqueiam esta tarefa

## Cenários de Uso

**Adequado para:**
- Ver quais tarefas estão disponíveis (status pending, sem owner, não bloqueadas)
- Verificar o progresso geral do projeto
- Encontrar tarefas bloqueadas
- Encontrar a próxima tarefa após concluir uma

## Observações

- Prefira processar tarefas em ordem de ID (menor ID primeiro), pois tarefas anteriores geralmente fornecem contexto para as posteriores
- Tarefas com `blockedBy` não podem ser reivindicadas até que as dependências sejam resolvidas
- Use TaskGet para obter detalhes completos de uma tarefa específica

## Significado no cc-viewer

TaskList é uma operação interna de gerenciamento de tarefas, não gera requisições API independentes.

## Texto original

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
