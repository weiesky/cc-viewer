# Workflow

Executa um script que orquestra muitos subagentes de forma determinística — fan-out, pipelines, loops e verificação — para trabalho amplo demais, incerto demais ou grande demais para um único contexto.

## Quando usar

- Decompor uma tarefa grande e cobri-la em paralelo entre muitos agentes
- Cruzar achados com verificação independente ou adversarial antes de se comprometer com eles
- Assumir uma escala que um único contexto não comporta: migrações, auditorias, varreduras amplas em múltiplos arquivos

## Como funciona

- Roda em segundo plano; você é notificado quando termina. Acompanhe o progresso ao vivo com `/workflows`.
- O script coordena agentes com `agent()`, `parallel()`, `pipeline()` e `phase()`.
- `pipeline()` faz cada item fluir pelos estágios sem barreira (padrão); `parallel()` é uma barreira que espera por todos os resultados.
- Com um schema, cada `agent()` retorna dados estruturados validados em vez de texto livre.

## Observações

- Só roda quando o usuário opta explicitamente por orquestração multiagente; pode gerar muitos agentes e consumir uma quantidade significativa de tokens.
- A concorrência é limitada por workflow; agentes em excesso ficam na fila e rodam conforme as vagas se liberam.
- Para um único subagente, use a ferramenta `Agent`; reserve o Workflow para fan-out de verdade.

## Conceitos relacionados

- Baseia-se na ferramenta `Agent`, executando muitos agentes sob controle de fluxo determinístico.
