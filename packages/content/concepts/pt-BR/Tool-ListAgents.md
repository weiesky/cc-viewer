# ListAgents

Lista os agents para os quais você pode `SendMessage`: subagents in-process que você gerou, outras sessões locais do Claude nesta máquina, suas sessões na nuvem (quando esta sessão tem acesso à nuvem) e — quando o Remote Control está conectado — as outras sessões da sua conta. Cada linha é rotulada por tipo.

## Quando usar

- Você precisa do nome exato de uma sessão par ou de um subagent antes de enviar uma mensagem a ele.
- Você quer ver quais sessões estão alcançáveis a partir desta no momento.

## Ativação

- Requer Claude Code 2.1.224+ e mensagens entre sessões (uma feature flag do lado do servidor, desativada por padrão).
- Mensagens entre sessões estão indisponíveis no Amazon Bedrock, no Claude Platform on AWS, no Google Cloud Agent Platform e no Microsoft Foundry.
- Desativado quando `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK` ou `DISABLE_GROWTHBOOK` está definido.
- Habilite à força com `CLAUDE_CODE_HARBOR_KITE=1`.

## Parâmetros

- `channel` (string, opcional): Não disponível nesta build; deixe indefinido.
- `q` (string, opcional): Não disponível nesta build; deixe indefinido.

## Exemplos

### Exemplo 1: Listar agents alcançáveis

```
ListAgents()
```

Cada linha imprime um nome — esse nome é o endereço. Envie com `SendMessage({to: "<name>", message: "..."})`, copiando o nome exatamente como impresso. Acrescente o ` [ref]` de uma linha apenas quando o nome puro for ambíguo (duas linhas o compartilham, ou um erro pede que você desambigue).

## Observações

- Somente leitura e seguro para concorrência.
- Uma sessão na nuvem recebe sua mensagem, mas ainda não pode responder de volta — leia a resposta no próprio transcript dela.
