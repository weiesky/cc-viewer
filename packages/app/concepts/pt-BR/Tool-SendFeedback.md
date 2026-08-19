# SendFeedback

Envia feedback estruturado sobre o Claude Code para a Anthropic — relatórios de bug, ideias de funcionalidades ou capacidades ausentes — sem sair da sessão.

## Quando usar

- O usuário pede para relatar um bug ou enviar feedback sobre o próprio Claude Code.
- Você encontra um defeito claro de produto (comando quebrado, comportamento errado, crash) que vale a pena relatar.
- O usuário descreve uma funcionalidade que gostaria que existisse (uma ideia ou capacidade ausente).

## Parâmetros

- `type` (string, obrigatório): Um de `bug`, `idea`, `missing_capability`.
- `title` (string, obrigatório): Resumo curto e específico do problema em uma linha.
- `details` (string, obrigatório): Bullets rotulados, em ordem: **What happened:** (observado vs. esperado, texto de erro exato se curto); **What the user said:** (citado, ou "User didn't comment; observed by the model."); **Repro:** (passos mínimos); **Evidence:** (request IDs, timestamps, paths, versions — omita se não houver); opcionalmente um **Cause:** final apenas se verificado na sessão. Uma a três linhas por bullet; sem parágrafos narrativos, sem especulação, sem segredos.
- `area` (string, opcional): Tag curta nomeando a parte do Claude Code de que se trata (por exemplo, "hooks config", "/help", "file editing"). Deixe em branco se não estiver claro.
- `failure_mode` (string, opcional): Para relatórios de comportamento do modelo, o modo de falha mais próximo (por exemplo, `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short` ou `other`). Omita apenas quando o relatório for um bug puro de produto/ferramenta.
- `task_category` (string, opcional): O que a sessão estava fazendo quando o problema ocorreu: `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review` ou `other`.

## Exemplos

### Exemplo 1: Relatar um bug de produto

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Observações

- Nunca inclua segredos, tokens ou dados privados do usuário em `details`.
- Cite as palavras do usuário quando disponíveis; caso contrário, declare que o modelo observou o problema.
- Mantenha o relatório factual — especulação sobre a causa raiz pertence a `**Cause:**` apenas quando verificada na sessão.
