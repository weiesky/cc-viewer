# TaskStop

Para uma tarefa em segundo plano em execução — um comando de shell, um agente despachado ou uma sessão remota — por seu handle de execução. Use-o para liberar recursos, cancelar trabalho que não é mais útil ou se recuperar quando uma tarefa está travada.

## Quando usar

- Um comando de shell em segundo plano rodou mais do que o esperado e você não precisa mais do resultado.
- Um agente local está em loop ou parou e precisa ser cortado.
- O usuário mudou de direção e o trabalho em segundo plano para a direção anterior deve ser abandonado.
- Uma sessão remota está prestes a atingir o timeout ou está segurando um recurso que você precisa.
- Você precisa de um estado limpo antes de iniciar uma nova execução da mesma tarefa.

Prefira deixar o trabalho em segundo plano de vida curta terminar sozinho. `TaskStop` é para casos em que continuar a execução não tem valor ou é ativamente prejudicial.

## Parâmetros

- `task_id` (string, obrigatório): O handle de execução retornado quando a tarefa em segundo plano foi iniciada. Este é o mesmo identificador aceito por `TaskOutput`, não um `taskId` da lista de tarefas.

## Exemplos

### Exemplo 1

Parar um comando de shell em segundo plano descontrolado.

```
TaskStop(task_id: "bash_01HXYZ...")
```

O comando recebe um sinal de término; a saída bufferizada escrita até agora permanece legível em seu caminho de saída.

### Exemplo 2

Cancelar um agente despachado após uma correção de rumo do usuário.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Observações

- `TaskStop` solicita terminação; não garante desligamento instantâneo. Tarefas bem comportadas saem prontamente, mas um processo fazendo I/O bloqueante pode levar um momento para se encerrar.
- Parar uma tarefa não exclui sua saída. Para tarefas de shell em segundo plano, o arquivo de saída no disco é preservado e ainda legível com `Read`. Para agentes e sessões, qualquer saída capturada antes da parada ainda é acessível via `TaskOutput`.
- Um `task_id` desconhecido, ou uma tarefa que já terminou, retorna um erro ou no-op. Isso é seguro — você pode chamar `TaskStop` defensivamente sem verificar o status primeiro.
- Se você pretende reiniciar o mesmo trabalho, pare a tarefa antiga antes de despachar a nova para evitar duas execuções paralelas competindo por recursos compartilhados (arquivos, portas, linhas de banco de dados).
- `TaskStop` não afeta entradas na lista de tarefas da equipe. Para cancelar uma tarefa rastreada, atualize seu status para `deleted` com `TaskUpdate`.
