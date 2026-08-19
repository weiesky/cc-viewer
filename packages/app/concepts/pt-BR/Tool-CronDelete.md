# CronDelete

Cancela um job cron previamente agendado com `CronCreate`. Remove-o imediatamente do armazenamento de sessão em memória. Não tem efeito se o job já foi excluído automaticamente (jobs de execução única são removidos após disparar, jobs recorrentes expiram após 7 dias).

## Quando usar

- Um usuário solicita interromper uma tarefa agendada recorrente antes da expiração automática de 7 dias.
- Um job de execução única não é mais necessário e deve ser cancelado antes de disparar.
- É necessário alterar a expressão de agendamento de um job existente — excluí-lo com `CronDelete` e, em seguida, recriá-lo com `CronCreate` usando a nova expressão.
- Limpar vários jobs desatualizados para manter o armazenamento de sessão organizado.

## Parâmetros

- `id` (string, obrigatório): O ID do job retornado por `CronCreate` quando o job foi criado pela primeira vez. Este valor deve corresponder exatamente; busca aproximada ou por nome não é suportada.

## Exemplos

### Exemplo 1: cancelar um job recorrente em execução

Um job recorrente foi criado anteriormente com o ID `"cron_abc123"`. O usuário solicita sua interrupção.

```
CronDelete({ id: "cron_abc123" })
```

O job é removido do armazenamento de sessão e não será disparado novamente.

### Exemplo 2: remover um job de execução única desatualizado antes de disparar

Um job de execução única com ID `"cron_xyz789"` foi agendado para ser executado em 30 minutos, mas o usuário decidiu que não é mais necessário.

```
CronDelete({ id: "cron_xyz789" })
```

O job é cancelado. Nenhuma ação será executada quando o momento de disparo original chegar.

## Observações

- O `id` deve ser obtido do valor de retorno de `CronCreate`. Não há como buscar um job por descrição ou callback — armazene o ID caso precise cancelar mais tarde.
- Se o job já foi excluído automaticamente (disparado como execução única, ou atingiu a expiração recorrente de 7 dias), chamar `CronDelete` com esse ID é uma operação sem efeito e não produzirá um erro.
- `CronDelete` afeta apenas a sessão em memória atual. Se o ambiente de execução não persistir o estado do cron entre reinicializações, os jobs agendados serão perdidos na reinicialização independentemente de `CronDelete` ter sido chamado.
- Não existe operação de exclusão em lote; cancele cada job individualmente usando seu próprio `id`.
