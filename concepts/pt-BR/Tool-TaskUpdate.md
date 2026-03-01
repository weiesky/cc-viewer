# TaskUpdate

## Definição

Atualiza o status, conteúdo ou dependências de uma tarefa na lista de tarefas.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `taskId` | string | Sim | ID da tarefa a atualizar |
| `status` | enum | Não | Novo status: `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Não | Novo título |
| `description` | string | Não | Nova descrição |
| `activeForm` | string | Não | Texto no gerúndio exibido quando em andamento |
| `owner` | string | Não | Novo responsável pela tarefa (nome do agent) |
| `metadata` | object | Não | Metadados a mesclar (definir como null para excluir chave) |
| `addBlocks` | string[] | Não | Lista de IDs de tarefas bloqueadas por esta tarefa |
| `addBlockedBy` | string[] | Não | Lista de IDs de tarefas pré-requisito que bloqueiam esta tarefa |

## Fluxo de Status

```
pending → in_progress → completed
```

`deleted` pode ser atingido a partir de qualquer status, removendo permanentemente a tarefa.

## Cenários de Uso

**Adequado para:**
- Marcar tarefa como `in_progress` ao iniciar o trabalho
- Marcar tarefa como `completed` após concluir o trabalho
- Definir dependências entre tarefas
- Atualizar conteúdo da tarefa quando requisitos mudam

**Regras importantes:**
- Só marcar como `completed` quando a tarefa estiver totalmente concluída
- Manter como `in_progress` ao encontrar erros ou bloqueios
- Não marcar como `completed` quando testes falham, implementação está incompleta ou há erros não resolvidos

## Observações

- Antes de atualizar, deve-se obter o status mais recente da tarefa via TaskGet para evitar dados desatualizados
- Após concluir uma tarefa, chamar TaskList para encontrar a próxima tarefa disponível

## Significado no cc-viewer

TaskUpdate é uma operação interna de gerenciamento de tarefas, não gera requisições API independentes.

## Texto original

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
