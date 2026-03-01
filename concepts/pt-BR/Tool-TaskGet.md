# TaskGet

## Definição

Obtém os detalhes completos de uma tarefa através do ID da tarefa.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `taskId` | string | Sim | ID da tarefa a obter |

## Conteúdo Retornado

- `subject` — Título da tarefa
- `description` — Requisitos detalhados e contexto
- `status` — Status: `pending`, `in_progress` ou `completed`
- `blocks` — Lista de tarefas bloqueadas por esta tarefa
- `blockedBy` — Lista de tarefas pré-requisito que bloqueiam esta tarefa

## Cenários de Uso

**Adequado para:**
- Obter a descrição completa e contexto da tarefa antes de iniciar o trabalho
- Entender as dependências da tarefa
- Obter requisitos completos após ser atribuído a uma tarefa

## Observações

- Após obter a tarefa, deve-se verificar se a lista `blockedBy` está vazia antes de iniciar o trabalho
- Use TaskList para ver o resumo de todas as tarefas

## Significado no cc-viewer

TaskGet é uma operação interna de gerenciamento de tarefas, não gera requisições API independentes.

## Texto original

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
