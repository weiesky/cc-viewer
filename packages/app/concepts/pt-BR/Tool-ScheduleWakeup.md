# ScheduleWakeup

Agenda quando retomar o trabalho no modo dinâmico `/loop`. A ferramenta permite que o Claude gerencie autonomamente o ritmo das iterações de uma tarefa, dormindo pelo intervalo escolhido e depois disparando novamente com o mesmo prompt do loop.

## Quando usar

- Para autogerenciar o ritmo de uma tarefa dinâmica `/loop` onde o intervalo de iteração depende do estado do trabalho em vez de um relógio fixo
- Para aguardar a conclusão de uma compilação longa, implantação ou execução de testes antes de verificar os resultados
- Para inserir ticks ociosos entre iterações quando não há sinal específico para monitorar no momento
- Para executar um loop autônomo sem prompt do usuário — passe o sentinel literal `<<autonomous-loop-dynamic>>` como `prompt`
- Para sondar um processo cujo estado está prestes a mudar (use um atraso curto para manter o cache quente)

## Ativação

- Não disponível no Amazon Bedrock, no Claude Platform on AWS, no Google Cloud Agent Platform ou no Microsoft Foundry.
- Também desativado quando a busca de feature flags está desabilitada (variáveis de ambiente de telemetria/tráfego).

## Parâmetros

- `delaySeconds` (número, obrigatório): Segundos até a retomada. O runtime limita automaticamente o valor a `[60, 3600]`, portanto a limitação manual não é necessária.
- `reason` (string, obrigatório): Uma frase curta explicando o atraso escolhido. Exibida ao usuário e registrada na telemetria. Seja específico — "verificando compilação longa do bun" é mais útil do que "aguardando."
- `prompt` (string, obrigatório): O input `/loop` a disparar ao acordar. Passe a mesma string em cada turno para que o próximo disparo repita a tarefa. Para um loop autônomo sem prompt do usuário, passe o sentinel literal `<<autonomous-loop-dynamic>>`.

## Exemplos

### Exemplo 1: atraso curto para verificar novamente um sinal que muda rapidamente (manter o cache quente)

Uma compilação acabou de ser iniciada e normalmente termina em dois a três minutos.

```json
{
  "delaySeconds": 120,
  "reason": "verificando compilação do bun com conclusão esperada em ~2 min",
  "prompt": "verificar status da compilação e relatar erros"
}
```

120 segundos mantém o contexto da conversa no cache de prompts da Anthropic (TTL 5 min), tornando o próximo acordar mais rápido e barato.

### Exemplo 2: tick ocioso longo (aceitar cache miss, amortizar em uma espera mais longa)

Uma migração de banco de dados está em execução e normalmente leva 20–40 minutos.

```json
{
  "delaySeconds": 1200,
  "reason": "migração normalmente leva 20–40 min; verificando em 20 min",
  "prompt": "verificar status da migração e continuar se concluída"
}
```

O cache estará frio ao acordar, mas a espera de 20 minutos amortiza com folga o custo do único cache miss. Sondar a cada 5 minutos pagaria o mesmo custo de miss 4 vezes sem nenhum benefício.

## Observações

- **TTL de cache de 5 minutos**: O cache de prompts da Anthropic expira após 300 segundos. Atrasos abaixo de 300 s mantêm o contexto quente; atrasos acima de 300 s incorrem em cache miss no próximo acordar.
- **Evite exatamente 300 s**: É o pior dos dois mundos — você paga o cache miss sem obter uma espera significativamente mais longa. Ou reduza para 270 s (manter cache quente) ou comprometa-se com 1200 s ou mais (um miss compra uma espera muito mais longa).
- **Padrão para ticks ociosos**: Quando não há sinal específico para monitorar, use **1200–1800 s** (20–30 min). Isso permite que o loop verifique periodicamente sem queimar o cache 12 vezes por hora sem motivo.
- **Limitação automática**: O runtime limita `delaySeconds` a `[60, 3600]`. Valores abaixo de 60 tornam-se 60; valores acima de 3600 tornam-se 3600. Não é necessário tratar esses limites manualmente.
- **Omita a chamada para encerrar o loop**: Se você pretende parar as iterações, não chame ScheduleWakeup. Simplesmente omitir a chamada encerra o loop.
- **Passe o mesmo `prompt` a cada turno**: O campo `prompt` deve conter a instrução `/loop` original em cada invocação para que o próximo acordar saiba qual tarefa retomar.
