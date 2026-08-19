# Visão Geral das Ferramentas do Claude Code

O Claude Code fornece ao modelo um conjunto de ferramentas integradas através do mecanismo tool_use da API da Anthropic. O array `tools` de cada requisição MainAgent contém as definições completas em JSON Schema dessas ferramentas, e o modelo as invoca através de content blocks `tool_use` na resposta.

A seguir está o índice categorizado de todas as ferramentas.

## Sistema de Agents

| Ferramenta | Finalidade |
|------|------|
| [Agent](Tool-Agent.md) | Iniciar um sub-agent (SubAgent) para processar tarefas complexas de múltiplas etapas |
| [TaskOutput](Tool-TaskOutput.md) | Obter a saída de tarefas em segundo plano |
| [TaskStop](Tool-TaskStop.md) | Parar uma tarefa em segundo plano em execução |
| [TaskCreate](Tool-TaskCreate.md) | Criar uma entrada na lista de tarefas estruturada |
| [TaskGet](Tool-TaskGet.md) | Obter detalhes de uma tarefa |
| [TaskUpdate](Tool-TaskUpdate.md) | Atualizar status, dependências, etc. de uma tarefa |
| [TaskList](Tool-TaskList.md) | Listar todas as tarefas |
| [ListAgents](Tool-ListAgents.md) | Listar os agents disponíveis na sessão |

## Equipe e Orquestração

| Ferramenta | Finalidade |
|------|------|
| [SendMessage](Tool-SendMessage.md) | Enviar uma mensagem para outro agent |
| [Workflow](Tool-Workflow.md) | Rodar um script de orquestração multi-agent determinístico |
| [Monitor](Tool-Monitor.md) | Transmitir eventos de um script de longa duração como notificações |
| [SendFile](Tool-SendFile.md) | Enviar arquivos para outra sessão do Claude Code |
| [SendUserFile](Tool-SendUserFile.md) | Enviar arquivos para o usuário |
| [SendUserMessage](Tool-SendUserMessage.md) | Enviar uma mensagem para o usuário (ferramenta Brief legada) |
| [EndConversation](Tool-EndConversation.md) | Encerrar a conversa atual |

## Operações de Arquivo

| Ferramenta | Finalidade |
|------|------|
| [Read](Tool-Read.md) | Ler conteúdo de arquivo (suporta texto, imagens, PDF, Jupyter notebook) |
| [Edit](Tool-Edit.md) | Editar arquivo através de substituição exata de string |
| [Write](Tool-Write.md) | Escrever ou sobrescrever arquivo |
| [NotebookEdit](Tool-NotebookEdit.md) | Editar células de Jupyter notebook |

## Busca

| Ferramenta | Finalidade |
|------|------|
| [Glob](Tool-Glob.md) | Buscar arquivos por padrão de nome de arquivo |
| [Grep](Tool-Grep.md) | Busca de conteúdo de arquivo baseada em ripgrep |
| [ToolSearch](Tool-ToolSearch.md) | Buscar e carregar ferramentas deferred/MCP sob demanda |

## Terminal

| Ferramenta | Finalidade |
|------|------|
| [Bash](Tool-Bash.md) | Executar comandos shell |
| [REPL](Tool-REPL.md) | Executar JavaScript em um REPL Node.js persistente |

## Web

| Ferramenta | Finalidade |
|------|------|
| [WebFetch](Tool-WebFetch.md) | Buscar conteúdo de página web e processar com IA |
| [WebSearch](Tool-WebSearch.md) | Consulta em mecanismo de busca |
| [Artifact](Tool-Artifact.md) | Publicar um arquivo HTML/Markdown como página web hospedada no claude.ai |
| [DesignSync](Tool-DesignSync.md) | Sincronizar uma biblioteca de componentes local com um projeto design-system no claude.ai |

## Planejamento e Interação

| Ferramenta | Finalidade |
|------|------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Entrar no modo de planejamento para projetar plano de implementação |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Sair do modo de planejamento e submeter plano para aprovação do usuário |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Fazer perguntas ao usuário para obter esclarecimentos ou decisões |
| [ReportFindings](Tool-ReportFindings.md) | Relatar achados de revisão de código como uma lista tipada para a UI hospedeira |
| [TodoWrite](Tool-TodoWrite.md) | Escrever uma lista de tarefas estruturada para a sessão |
| [SendFeedback](Tool-SendFeedback.md) | Enviar feedback estruturado sobre o Claude Code para a Anthropic |
| [Projects](Tool-Projects.md) | Gerenciar documentos da base de conhecimento do projeto |
| [ProposeGoal](Tool-ProposeGoal.md) | Propor uma meta de conclusão verificável para a sessão |

## Worktrees

| Ferramenta | Finalidade |
|------|------|
| [EnterWorktree](Tool-EnterWorktree.md) | Criar ou entrar em um worktree git isolado para a sessão |
| [ExitWorktree](Tool-ExitWorktree.md) | Sair do worktree, mantendo ou removendo |

## Agendamento e Notificações

| Ferramenta | Finalidade |
|------|------|
| [CronCreate](Tool-CronCreate.md) | Agendar um prompt em uma expressão cron (recorrente ou uma única vez) |
| [CronDelete](Tool-CronDelete.md) | Cancelar um trabalho cron agendado |
| [CronList](Tool-CronList.md) | Listar trabalhos cron agendados |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Auto-ritmo iterações de /loop agendando o próximo wakeup |
| [PushNotification](Tool-PushNotification.md) | Enviar uma notificação desktop/mobile para o usuário |
| [RemoteTrigger](Tool-RemoteTrigger.md) | Gerenciar rotinas remotas-trigger do claude.ai |
| [ReadNotifications](Tool-ReadNotifications.md) | Ler notificações pendentes da sessão |

## Extensões

| Ferramenta | Finalidade |
|------|------|
| [Skill](Tool-Skill.md) | Executar skill (slash command) |

## MCP e extensões

| Ferramenta | Finalidade |
|------|------|
| [ListMcpResources](Tool-ListMcpResources.md) | Listar recursos expostos por servidores MCP conectados |
| [ReadMcpResource](Tool-ReadMcpResource.md) | Ler um único recurso de servidor MCP por URI |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | Listar um recurso MCP em estilo de diretório por URI |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | Buscar o registro de conectores MCP por palavra-chave |
| [SuggestConnectors](Tool-SuggestConnectors.md) | Resolver detalhes de conectores a partir de resultados de busca no registro |
| [ListConnectors](Tool-ListConnectors.md) | Listar conectores MCP instalados |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | Renderizar um card inline de instalação de plugin |
| [SuggestSkills](Tool-SuggestSkills.md) | Renderizar um card de skills adicionáveis |
| [ListPlugins](Tool-ListPlugins.md) | Listar plugins do claude.ai habilitados |
| [ListSkills](Tool-ListSkills.md) | Listar skills do claude.ai habilitadas |

## Integração com IDE

| Ferramenta | Finalidade |
|------|------|
| [LSP](Tool-LSP.md) | Consultas de language-server (definições, referências, símbolos) |
