# ReadNotifications

Lê notificações enfileiradas para o assistente na sessão atual — atividade do GitHub em PRs inscritos (`github_webhook`), disparos de gatilhos agendados (`trigger_fire`) e mensagens chegando de outras sessões do Claude (`mcp_send_message`).

## Quando usar

- Você foi notificado de que algo aconteceu — um PR inscrito foi atualizado, um gatilho agendado disparou, outra sessão enviou mensagem para você — e precisa do payload real.
- Drenar um backlog: lotes grandes são retornados em partes, então continue chamando até que o resultado reporte 0 `remaining`.

## Parâmetros

Esta ferramenta não recebe parâmetros.

## Exemplos

### Exemplo 1: Drenar notificações pendentes

```
ReadNotifications()
```

Retorna as notificações enfileiradas, as mais antigas primeiro. O resultado inclui uma contagem `remaining` de notificações ainda enfileiradas após esta drenagem — chame a ferramenta novamente para lê-las.

## Observações

- As drenagens têm orçamento de tamanho: uma chamada de acompanhamento retorna o restante da mesma fila (mais qualquer coisa recém-chegada), não apenas chegadas novas. Repita até que `remaining` seja 0.
- As notificações se originam de webhooks do GitHub em PRs inscritos, gatilhos agendados e mensagens de outras sessões do Claude; não há parâmetro de filtragem na versão atual.
