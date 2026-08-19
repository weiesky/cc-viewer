# Teammate

## Definicao

Um Teammate e um agent colaborativo no modo Team do Claude Code Agent. Quando o agent principal cria um time com `TeamCreate` e gera teammates usando a ferramenta `Agent`, cada teammate e executado como um processo agent independente, com sua propria janela de contexto e conjunto de ferramentas, comunicando-se com os membros do time atraves de `SendMessage`.

## Diferencas em relacao ao SubAgent

| Caracteristica | Teammate | SubAgent |
|----------------|----------|----------|
| Ciclo de vida | Persiste, pode receber multiplas mensagens | Tarefa unica, destruido ao concluir |
| Comunicacao | SendMessage mensagens bidirecionais | Chamada unidirecional pai->filho, retorna resultado |
| Contexto | Contexto completo independente, mantido entre turnos | Contexto de tarefa isolado |
| Modo de colaboracao | Colaboracao em equipe, comunicacao mutua possivel | Estrutura hierarquica, interacao apenas com o agent pai |
| Tipo de tarefa | Tarefas complexas de multiplas etapas | Tarefas unicas como busca, exploracao |

## Comportamento

- Criado pelo agent principal (team lead) atraves da ferramenta `Agent` e atribuido a um `team_name`
- Compartilha a lista de tarefas via `TaskList` / `TaskGet` / `TaskUpdate`
- Entra em estado idle apos cada turno de execucao, aguardando novas mensagens para reativacao
- Pode ser encerrado de forma ordenada via `shutdown_request`

## Descricao do painel de estatisticas

O painel de estatisticas do Teammate exibe o numero de chamadas de API para cada teammate. A coluna `Name` contem o nome do teammate (ex.: `reviewer-security`, `reviewer-pipeline`), a coluna `Contagem` indica o numero total de requisicoes de API geradas por aquele teammate.
