# Agent

Inicia um subagente autônomo do Claude Code com sua própria janela de contexto para lidar com uma tarefa focada e retornar um único resultado consolidado. Este é o mecanismo canônico para delegar pesquisas abertas, trabalho paralelo ou colaboração em equipe.

## Quando usar

- Pesquisas abertas em que você ainda não sabe quais arquivos são relevantes e espera várias rodadas de `Glob`, `Grep` e `Read`.
- Trabalho independente paralelo — dispare vários agentes em uma única mensagem para investigar áreas distintas simultaneamente.
- Isolar exploração ruidosa da conversa principal para que o contexto do agente pai permaneça compacto.
- Delegar para um tipo de subagente especializado como `Explore`, `Plan`, `claude-code-guide` ou `statusline-setup`.
- Inserir um colega de equipe nomeado em uma equipe ativa para trabalho multiagente coordenado.

NÃO use quando o arquivo ou símbolo-alvo já é conhecido — use `Read`, `Grep` ou `Glob` diretamente. Uma consulta de passo único via `Agent` desperdiça uma janela de contexto inteira e adiciona latência.

## Parâmetros

- `description` (string, obrigatório): Rótulo curto de 3–5 palavras descrevendo a tarefa; exibido na interface e nos logs.
- `prompt` (string, obrigatório): O briefing completo e autossuficiente que o agente executará. Deve incluir todo o contexto necessário, restrições e o formato de retorno esperado.
- `subagent_type` (string, opcional): Persona predefinida como `general-purpose`, `Explore`, `Plan`, `claude-code-guide` ou `statusline-setup`. O padrão é `general-purpose`.
- `run_in_background` (boolean, opcional): Se `true`, o agente executa de forma assíncrona e o agente pai pode continuar trabalhando; os resultados são recuperados depois.
- `model` (string, opcional): Substitui o modelo para este agente — `opus`, `sonnet` ou `haiku`. O padrão é o modelo da sessão pai.
- `isolation` (string, opcional): Defina como `worktree` para rodar o agente dentro de um worktree git isolado para que suas gravações no sistema de arquivos não colidam com o pai.
- `team_name` (string, opcional): Ao inserir em uma equipe existente, o identificador da equipe que o agente entrará.
- `name` (string, opcional): Nome endereçável do colega de equipe, usado como alvo `to` em `SendMessage`.

## Exemplos

### Exemplo 1: Busca aberta de código

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Exemplo 2: Investigações independentes paralelas

Dispare dois agentes na mesma mensagem — um inspecionando o pipeline de build, outro revisando o harness de testes. Cada um recebe sua própria janela de contexto e retorna um resumo. Agrupá-los em um único bloco de chamadas de ferramenta os executa simultaneamente.

### Exemplo 3: Inserir um colega de equipe em uma equipe em execução

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Observações

- Agentes não têm memória de execuções anteriores. Cada invocação começa do zero, portanto o `prompt` deve ser totalmente autossuficiente — inclua caminhos de arquivos, convenções, a pergunta e o formato exato da resposta desejada.
- O agente retorna exatamente uma mensagem final. Ele não pode fazer perguntas de esclarecimento durante a execução, então ambiguidade no prompt vira suposição no resultado.
- Executar múltiplos agentes em paralelo é significativamente mais rápido do que chamadas sequenciais quando as subtarefas são independentes. Agrupe-os em um único bloco de chamadas de ferramenta.
- Use `isolation: "worktree"` sempre que um agente for gravar arquivos e você quiser revisar as mudanças antes de integrar na árvore de trabalho principal.
- Prefira `subagent_type: "Explore"` para reconhecimento somente leitura e `Plan` para trabalho de design; `general-purpose` é o padrão para tarefas mistas de leitura/escrita.
- Agentes em segundo plano (`run_in_background: true`) são adequados para trabalhos longos; evite polling em loop com `sleep` — o pai é notificado na conclusão.
