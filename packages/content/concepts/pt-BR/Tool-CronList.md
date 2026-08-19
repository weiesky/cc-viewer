# CronList

Lista todos os jobs cron agendados via `CronCreate` na sessao atual. Retorna um resumo de cada cron ativo, incluindo `id`, expressao cron, `prompt` abreviado, flag `recurring`, flag `durable` e o proximo horario de execucao.

## Quando usar

- Para auditar todos os jobs atualmente agendados antes de fazer alteracoes ou encerrar uma sessao.
- Para encontrar o `id` correto de um job antes de chamar `CronDelete` para remove-lo.
- Para depurar por que um job esperado nunca foi disparado, confirmando sua existencia e verificando o proximo horario de execucao.
- Para confirmar que um job de execucao unica (nao recorrente) ainda nao foi disparado e permanece pendente.

## Parametros

Nenhum.

## Exemplos

### Exemplo 1: auditar todos os jobs agendados

Invocar `CronList` sem argumentos para obter a lista completa de todos os jobs cron ativos. A resposta inclui para cada job seu `id`, a expressao cron que define seu agendamento, uma versao truncada do `prompt` que sera executado, se e `recurring` (recorrente), se e `durable` (persistente apos reinicializacoes) e o proximo horario de execucao agendado.

### Exemplo 2: localizar o id de uma tarefa recorrente especifica

Se varios jobs cron foram criados e e necessario excluir um especifico, invocar `CronList` primeiro. Percorrer a lista retornada para encontrar o job cujo resumo de `prompt` e expressao cron correspondam a tarefa a ser removida. Copiar seu `id` e passa-lo para `CronDelete`.

## Observacoes

- Apenas jobs criados na sessao atual sao listados, a menos que tenham sido criados com `durable: true`, o que permite que persistam apos reinicializacoes de sessao.
- O campo `prompt` no resumo e truncado; exibe apenas o inicio do texto completo do prompt, nao o conteudo integral.
- Jobs de execucao unica (`recurring` e `false`) que ja foram disparados sao excluidos automaticamente e nao aparecem mais na lista.
