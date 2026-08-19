# CronCreate

Agenda um prompt para ser colocado na fila em um momento futuro, seja uma única vez ou de forma recorrente. Utiliza a sintaxe cron padrão de 5 campos no fuso horário local do usuário, sem necessidade de conversão de fuso horário.

## Quando usar

- **Lembretes de uma única vez**: Quando o usuário quer ser lembrado em um horário específico ("me lembre amanhã às 15h"). Com `recurring: false`, a tarefa é excluída automaticamente após a execução.
- **Agendamentos recorrentes**: Quando algo precisa ser executado repetidamente ("todo dia útil às 9h", "a cada 30 minutos"). O valor padrão `recurring: true` cobre esse caso.
- **Loops de agente autônomo**: Para construir fluxos de trabalho que se re-ativam sozinhos conforme um cronograma — por exemplo, resumos diários ou verificações periódicas de status.
- **Tarefas duráveis**: Quando o agendamento precisa sobreviver a um reinício de sessão. Com `durable: true`, a tarefa é salva em `.claude/scheduled_tasks.json`.
- **Horários aproximados**: Quando o usuário diz "por volta das 9h" ou "a cada hora", escolha um valor de minuto deslocado (ex.: `57 8 * * *` ou `7 * * * *`) para evitar que muitos usuários se concentrem em :00 ou :30.

## Parâmetros

- `cron` (string, obrigatório): Expressão cron de 5 campos no fuso horário local do usuário. Formato: `minuto hora dia-do-mês mês dia-da-semana`. Exemplo: `"0 9 * * 1-5"` significa segunda–sexta às 9:00.
- `prompt` (string, obrigatório): O texto do prompt a ser colocado na fila quando o cron disparar — a mensagem exata que será enviada ao REPL no horário agendado.
- `recurring` (boolean, opcional, padrão `true`): Com `true`, o job é executado a cada intervalo cron correspondente e expira automaticamente após 7 dias. Com `false`, o job é executado exatamente uma vez e então excluído — para lembretes de uma única vez.
- `durable` (boolean, opcional, padrão `false`): Com `false`, o agendamento existe apenas na memória e é perdido ao encerrar a sessão. Com `true`, a tarefa é persistida em `.claude/scheduled_tasks.json` e sobrevive a reinicializações.

## Exemplos

### Exemplo 1: lembrete de uma única vez

O usuário diz: "Me lembre amanhã às 14:30 de enviar o relatório semanal." Supondo que amanhã seja 21 de abril:

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Lembrete: envie o relatório semanal agora.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` garante que a tarefa se exclua após disparar. `durable: true` a mantém em caso de reinicializações anteriores.

### Exemplo 2: tarefa matinal recorrente em dias úteis

O usuário diz: "Todo dia útil de manhã, resuma as minhas issues abertas no GitHub."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Resuma todas as issues abertas no GitHub atribuídas a mim.",
  "recurring": true,
  "durable": true
}
```

O minuto `3` em vez de `0` evita o pico de carga na hora exata. O job expira automaticamente após 7 dias.

## Observações

- **Expiração automática em 7 dias**: Jobs recorrentes são excluídos automaticamente após no máximo 7 dias. Para agendamentos mais longos, recrie a tarefa antes de ela expirar.
- **Dispara apenas em repouso**: `CronCreate` coloca o prompt na fila somente quando o REPL não está processando outra consulta. Se o REPL estiver ocupado no momento do disparo, o prompt aguarda o término da consulta atual.
- **Evite os minutos :00 e :30**: Para horários aproximados, escolha deliberadamente valores de minuto deslocados para distribuir a carga do sistema. Reserve :00/:30 apenas quando o usuário especificar esse minuto exato.
- **Sem conversão de fuso horário**: A expressão cron é interpretada diretamente no fuso horário local do usuário. Não é necessário converter para UTC ou qualquer outro fuso.
