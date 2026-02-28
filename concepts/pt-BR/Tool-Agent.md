# Agent

## Definição

Inicia um sub-agent (SubAgent) para processar autonomamente tarefas complexas de múltiplas etapas. Sub-agents são subprocessos independentes, cada um com seu próprio conjunto de ferramentas e contexto dedicados. Agent é a versão renomeada da ferramenta Task nas versões mais recentes do Claude Code.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `prompt` | string | Sim | Descrição da tarefa a ser executada pelo sub-agent |
| `description` | string | Sim | Resumo curto de 3-5 palavras |
| `subagent_type` | string | Sim | Tipo do sub-agent, determina o conjunto de ferramentas disponíveis |
| `model` | enum | Não | Modelo especificado (sonnet / opus / haiku), herda do pai por padrão |
| `max_turns` | integer | Não | Número máximo de turnos agênticos |
| `run_in_background` | boolean | Não | Se deve executar em segundo plano; tarefas em segundo plano retornam caminho do output_file |
| `resume` | string | Não | ID do agent a retomar, continua da última execução. Útil para retomar um sub-agent anterior sem perder o contexto |
| `isolation` | enum | Não | Modo de isolamento, `worktree` cria um git worktree temporário |

## Tipos de Sub-agent

| Tipo | Finalidade | Ferramentas Disponíveis |
|------|------|----------|
| `Bash` | Execução de comandos, operações git | Bash |
| `general-purpose` | Tarefas genéricas de múltiplas etapas | Todas as ferramentas |
| `Explore` | Exploração rápida da base de código | Todas exceto Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Projetar plano de implementação | Todas exceto Agent/Edit/Write/NotebookEdit/ExitPlanMode |
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
- Pode iniciar múltiplas chamadas Agent em paralelo em uma única mensagem para maior eficiência
- Tarefas em segundo plano verificam progresso via ferramenta TaskOutput
- O tipo Explore é mais lento que chamar Glob/Grep diretamente, use apenas quando buscas simples não são suficientes
- Use `run_in_background: true` para tarefas de longa duração que não precisam de resultados imediatos; use o modo em primeiro plano (padrão) quando o resultado é necessário antes de prosseguir
- O parâmetro `resume` permite continuar uma sessão de sub-agent iniciada anteriormente, preservando o contexto acumulado

## Significado no cc-viewer

Agent é o novo nome da ferramenta Task nas versões recentes do Claude Code. A chamada Agent gera uma cadeia de requisições SubAgent, visível na lista de requisições como uma sequência de sub-requisições independente do MainAgent. Requisições SubAgent tipicamente possuem system prompt simplificado e menos definições de ferramentas, formando um contraste claro com o MainAgent. No cc-viewer, os nomes de ferramenta `Task` ou `Agent` podem aparecer dependendo da versão do Claude Code usada na conversa gravada.
