# TeamDelete

## Definição

Remove uma equipe e seus diretórios de tarefas associados quando o trabalho de colaboração multi-agent é concluído. Esta é a contrapartida de limpeza do TeamCreate.

## Comportamento

- Remove o diretório da equipe: `~/.claude/teams/{team-name}/`
- Remove o diretório de tarefas: `~/.claude/tasks/{team-name}/`
- Limpa o contexto da equipe da sessão atual

**Importante**: TeamDelete falhará se a equipe ainda tiver integrantes ativos. Os integrantes devem ser encerrados graciosamente primeiro via solicitações de shutdown do SendMessage.

## Uso típico

TeamDelete é chamado no final de um fluxo de trabalho de equipe:

1. Todas as tarefas estão concluídas
2. Integrantes são encerrados via `SendMessage` com `shutdown_request`
3. **TeamDelete** remove os diretórios de equipe e tarefas

## Ferramentas relacionadas

| Ferramenta | Finalidade |
|------------|------------|
| `TeamCreate` | Criar uma nova equipe e sua lista de tarefas |
| `SendMessage` | Comunicar com integrantes / enviar solicitações de shutdown |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gerenciar a lista de tarefas compartilhada |
| `Agent` | Iniciar integrantes que entram na equipe |
