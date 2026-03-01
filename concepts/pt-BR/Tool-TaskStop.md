# TaskStop

## Definição

Para uma tarefa em segundo plano que está em execução.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `task_id` | string | Não | ID da tarefa em segundo plano a parar |
| `shell_id` | string | Não | Descontinuado, use `task_id` em vez disso |

## Cenários de Uso

**Adequado para:**
- Encerrar tarefas de longa duração que não são mais necessárias
- Cancelar tarefas em segundo plano iniciadas por engano

## Observações

- Retorna status de sucesso ou falha
- O parâmetro `shell_id` está descontinuado, deve-se usar `task_id`

## Significado no cc-viewer

A chamada TaskStop em si não gera requisições API, é uma operação interna de gerenciamento de tarefas do Claude Code.

## Texto original

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
