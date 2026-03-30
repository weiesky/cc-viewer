# TeamCreate

## Definição

Cria uma nova equipe para coordenar múltiplos agents trabalhando em um projeto. As equipes permitem execução paralela de tarefas por meio de uma lista de tarefas compartilhada e troca de mensagens entre agents.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `team_name` | string | Sim | Nome para a nova equipe |
| `description` | string | Não | Descrição / propósito da equipe |
| `agent_type` | string | Não | Tipo / papel do líder da equipe |

## O que é criado

- **Arquivo de configuração da equipe**: `~/.claude/teams/{team-name}/config.json` — armazena lista de membros e metadados
- **Diretório da lista de tarefas**: `~/.claude/tasks/{team-name}/` — lista de tarefas compartilhada para todos os integrantes

Equipes têm correspondência 1:1 com listas de tarefas.

## Fluxo de trabalho da equipe

1. **TeamCreate** — criar a equipe e sua lista de tarefas
2. **TaskCreate** — definir tarefas para a equipe
3. **Agent** (com `team_name` + `name`) — iniciar integrantes que entram na equipe
4. **TaskUpdate** — atribuir tarefas aos integrantes via `owner`
5. Integrantes trabalham nas tarefas e se comunicam via **SendMessage**
6. Encerrar integrantes ao concluir, depois **TeamDelete** para limpeza

## Ferramentas relacionadas

| Ferramenta | Finalidade |
|------------|------------|
| `TeamDelete` | Remover equipe e diretórios de tarefas |
| `SendMessage` | Comunicação entre agents dentro da equipe |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gerenciar a lista de tarefas compartilhada |
| `Agent` | Iniciar integrantes que entram na equipe |
