# TaskOutput

## Definição

Obtém a saída de tarefas em segundo plano em execução ou concluídas. Aplicável a shells em segundo plano, agents assíncronos e sessões remotas.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `task_id` | string | Sim | ID da tarefa |
| `block` | boolean | Sim | Se deve bloquear aguardando a conclusão da tarefa, padrão `true` |
| `timeout` | number | Sim | Tempo máximo de espera (milissegundos), padrão 30000, máximo 600000 |

## Cenários de Uso

**Adequado para:**
- Verificar o progresso de agents em segundo plano iniciados via Task (`run_in_background: true`)
- Obter resultados de execução de comandos Bash em segundo plano
- Aguardar a conclusão de tarefas assíncronas e obter a saída

**Não adequado para:**
- Tarefas em primeiro plano — tarefas em primeiro plano retornam resultados diretamente, sem necessidade desta ferramenta

## Observações

- `block: true` bloqueia até a tarefa ser concluída ou atingir timeout
- `block: false` é usado para verificação não-bloqueante do estado atual
- O ID da tarefa pode ser encontrado via comando `/tasks`
- Aplicável a todos os tipos de tarefa: shells em segundo plano, agents assíncronos, sessões remotas

## Significado no cc-viewer

A chamada TaskOutput em si não gera requisições API, é uma operação interna de gerenciamento de tarefas do Claude Code e não aparece nos logs de requisição.

## Texto original

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
