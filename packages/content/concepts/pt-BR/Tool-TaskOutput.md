# TaskOutput

Busca a saída acumulada de uma tarefa em segundo plano em execução ou concluída — um comando de shell em segundo plano, um agente local ou uma sessão remota. Use quando precisar inspecionar o que uma tarefa de longa duração produziu até agora.

## Quando usar

- Uma sessão remota (por exemplo um sandbox na nuvem) está rodando e você precisa do stdout dela.
- Um agente local foi despachado em segundo plano e você quer progresso parcial antes que ele retorne.
- Um comando de shell em segundo plano está rodando há tempo suficiente para que você queira verificar sem pará-lo.
- Você precisa confirmar que uma tarefa em segundo plano está de fato progredindo antes de esperar mais ou chamar `TaskStop`.

Não recorra a `TaskOutput` reflexivamente. Para a maior parte do trabalho em segundo plano há um caminho mais direto — veja as observações abaixo.

## Parâmetros

- `task_id` (string, obrigatório): O identificador da tarefa retornado quando o trabalho em segundo plano foi iniciado. Não é o mesmo que um `taskId` da lista de tarefas; este é o handle de execução para a execução específica.
- `block` (boolean, opcional): Quando `true` (padrão), espera até que a tarefa produza nova saída ou termine antes de retornar. Quando `false`, retorna imediatamente com o que está bufferizado.
- `timeout` (number, opcional): Máximo de milissegundos para bloquear antes de retornar. Só significativo quando `block` é `true`. Padrão `30000`, máximo `600000`.

## Exemplos

### Exemplo 1

Espiar uma sessão remota sem bloquear.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Retorna qualquer stdout/stderr que foi produzido desde que a tarefa começou (ou desde sua última chamada `TaskOutput`, dependendo do runtime).

### Exemplo 2

Esperar brevemente por um agente local emitir mais saída.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Observações

- Comandos bash em segundo plano: `TaskOutput` está efetivamente depreciado para este caso de uso. Quando você inicia uma tarefa de shell em segundo plano, o resultado já inclui o caminho para seu arquivo de saída — leia esse caminho diretamente com a ferramenta `Read`. `Read` dá acesso aleatório, offsets de linha e uma visão estável; `TaskOutput` não.
- Agentes locais (a ferramenta `Agent` despachada em segundo plano): quando o agente termina, o resultado da ferramenta `Agent` já contém sua resposta final. Use-a diretamente. Não dê `Read` no arquivo de transcript simbólico — ele contém o fluxo completo de chamadas de ferramenta e transbordará a janela de contexto.
- Sessões remotas: `TaskOutput` é a forma correta e muitas vezes única de fazer stream da saída. Prefira `block: true` com um `timeout` modesto em vez de loops de polling apertados.
- Um `task_id` desconhecido, ou uma tarefa cuja saída foi coletada pelo garbage collector, retorna um erro. Despache o trabalho novamente se ainda precisar dele.
- `TaskOutput` não para a tarefa. Use `TaskStop` para terminar.
