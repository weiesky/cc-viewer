# Task

> **Nota:** Nas versões mais recentes do Claude Code, esta ferramenta foi renomeada para **Agent**. Consulte o documento [Tool-Agent](Tool-Agent).

## Definição

Inicia um sub-agent (SubAgent) para processar autonomamente tarefas complexas de múltiplas etapas. Sub-agents são subprocessos independentes, cada um com seu próprio conjunto de ferramentas e contexto dedicados.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `prompt` | string | Sim | Descrição da tarefa a ser executada pelo sub-agent |
| `description` | string | Sim | Resumo curto de 3-5 palavras |
| `subagent_type` | string | Sim | Tipo do sub-agent, determina o conjunto de ferramentas disponíveis |
| `model` | enum | Não | Modelo especificado (sonnet / opus / haiku), herda do pai por padrão |
| `max_turns` | integer | Não | Número máximo de turnos agênticos |
| `run_in_background` | boolean | Não | Se deve executar em segundo plano; tarefas em segundo plano retornam caminho do output_file |
| `resume` | string | Não | ID do agent a retomar, continua da última execução |
| `isolation` | enum | Não | Modo de isolamento, `worktree` cria um git worktree temporário |

## Tipos de Sub-agent

| Tipo | Finalidade | Ferramentas Disponíveis |
|------|------|----------|
| `Bash` | Execução de comandos, operações git | Bash |
| `general-purpose` | Tarefas genéricas de múltiplas etapas | Todas as ferramentas |
| `Explore` | Exploração rápida da base de código | Todas exceto Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Projetar plano de implementação | Todas exceto Task/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Q&A sobre guia de uso do Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configurar barra de status | Read, Edit |

## Cenários de Uso

**Adequado para:**
- Tarefas complexas que requerem múltiplas etapas autônomas
- Exploração e pesquisa aprofundada da base de código (usando tipo Explore)
- Trabalho paralelo que requer ambiente isolado
- Tarefas de longa duração que precisam executar em segundo plano

**Não adequado para:**
- Ler um caminho de arquivo específico — usar Read ou Glob diretamente
- Buscar em 2-3 arquivos conhecidos — usar Read diretamente
- Buscar definição de classe específica — usar Glob diretamente

## Observações

- Após conclusão, o sub-agent retorna uma única mensagem; seus resultados não são visíveis ao usuário, o agent principal precisa retransmitir
- Pode iniciar múltiplas chamadas Task em paralelo em uma única mensagem para maior eficiência
- Tarefas em segundo plano verificam progresso via ferramenta TaskOutput
- O tipo Explore é mais lento que chamar Glob/Grep diretamente, use apenas quando buscas simples não são suficientes
