# SendMessage

Entrega uma mensagem de um membro da equipe para outro dentro de uma equipe ativa, ou faz broadcast para todos os colegas de uma vez. Este é o único canal que os colegas de equipe podem ouvir — qualquer coisa escrita na saída de texto normal é invisível para eles.

## Quando usar

- Atribuir uma tarefa ou repassar um subproblema para um colega de equipe nomeado durante a colaboração em equipe.
- Solicitar status, achados intermediários ou uma revisão de código de outro agente.
- Transmitir uma decisão, restrição compartilhada ou anúncio de encerramento para toda a equipe via `*`.
- Responder a um prompt de protocolo, como um pedido de encerramento ou um pedido de aprovação de plano do líder da equipe.
- Fechar o ciclo ao final de uma tarefa delegada para que o líder possa marcar o item como completo.

## Ativação

- Gated pelas mesmas condições de mensagens entre sessões que `ListAgents` (feature flags do lado do servidor, desativadas por padrão).
- Colegas de equipe adicionalmente exigem que os agent teams experimentais estejam habilitados.

## Parâmetros

- `to` (string, obrigatório): O `name` do colega de equipe alvo registrado na equipe, ou `*` para fazer broadcast para todos os colegas de uma vez.
- `message` (string ou object, obrigatório): Texto comum para comunicação normal, ou um objeto estruturado para respostas de protocolo como `shutdown_response` e `plan_approval_response`.
- `summary` (string, opcional): Um preview de 5–10 palavras mostrado no log de atividade da equipe para mensagens de texto comum. Obrigatório para mensagens longas em string; ignorado quando `message` é um objeto de protocolo.

## Exemplos

### Exemplo 1: Repasse direto de tarefa

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Exemplo 2: Broadcast de uma restrição compartilhada

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Exemplo 3: Resposta de protocolo

Responda a um pedido de encerramento do líder usando uma mensagem estruturada:

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Exemplo 4: Resposta de aprovação de plano

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Observações

- Sua saída de texto comum do assistente NÃO é transmitida para colegas de equipe. Se você quer que outro agente veja algo, precisa passar por `SendMessage`. Este é o erro mais comum em workflows de equipe.
- Broadcast (`to: "*"`) é caro — ele acorda todo colega de equipe e consome o contexto deles. Reserve-o para anúncios que afetam genuinamente a todos. Prefira envios direcionados.
- Mantenha mensagens concisas e orientadas à ação. Inclua os caminhos de arquivo, restrições e formato de resposta esperado que o destinatário precisa; lembre-se de que eles não têm memória compartilhada com você.
- Objetos de mensagem de protocolo (`shutdown_response`, `plan_approval_response`) têm formas fixas. Não misture campos de protocolo em mensagens de texto comum ou vice-versa.
- Mensagens são assíncronas. O destinatário receberá a sua no próximo turno dele; não presuma que leu ou agiu sobre ela até que responda.
- Um `summary` bem escrito torna o log de atividade da equipe fácil de examinar para o líder — trate-o como o assunto de um commit.
