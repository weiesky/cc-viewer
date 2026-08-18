# TaskCreate

Cria uma nova tarefa na lista de tarefas da equipe atual (ou na lista de tarefas da sessão quando nenhuma equipe está ativa). Use-o para capturar itens de trabalho que devem ser rastreados, delegados ou revisitados depois.

## Quando usar

- O usuário descreve um trabalho de múltiplos passos que se beneficia de rastreamento explícito.
- Você está quebrando um grande pedido em unidades menores que podem ser concluídas separadamente.
- Um acompanhamento é descoberto no meio de uma tarefa e não deve ser esquecido.
- Você precisa de um registro durável de intenção antes de repassar o trabalho a um colega ou subagente.
- Você está operando em modo de plano e quer que cada passo do plano seja representado como uma tarefa concreta.

Evite `TaskCreate` para ações triviais de passo único, conversa pura ou qualquer coisa que possa ser concluída em duas ou três chamadas diretas de ferramenta.

## Ativação

- Disponível por padrão na maioria dos modelos.
- Não disponível no Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 e famílias posteriores (v2.1.233+) a menos que seja habilitado via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Todo o sistema de tarefas é desativado quando `CLAUDE_CODE_ENABLE_TASKS=false`.

## Parâmetros

- `subject` (string, obrigatório): Título curto imperativo, por exemplo `Fix login redirect on Safari`. Mantenha abaixo de cerca de oitenta caracteres.
- `description` (string, obrigatório): Contexto detalhado — o problema, as restrições, critérios de aceitação e quaisquer arquivos ou links que um leitor futuro precisará. Escreva como se um colega fosse pegar isso do zero.
- `activeForm` (string, opcional): Texto do spinner em gerúndio mostrado enquanto a tarefa está `in_progress`, por exemplo `Fixing login redirect on Safari`. Espelhe o `subject`, mas no gerúndio.
- `metadata` (object, opcional): Dados estruturados arbitrários anexados à tarefa. Usos comuns: labels, dicas de prioridade, IDs de tickets externos ou configuração específica do agente.

Tarefas recém-criadas sempre começam com status `pending` e sem owner. Dependências (`blocks`, `blockedBy`) não são definidas no momento da criação — aplique-as depois com `TaskUpdate`.

## Exemplos

### Exemplo 1

Capturar um relatório de bug que o usuário acabou de submeter.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Exemplo 2

Dividir um épico em unidades rastreadas no início de uma sessão.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Observações

- Escreva o `subject` na voz imperativa e o `activeForm` no gerúndio para que a interface leia naturalmente quando a tarefa transitar para `in_progress`.
- Chame `TaskList` antes de criar para evitar duplicatas — a lista de equipe é compartilhada com colegas e subagentes.
- Não inclua segredos ou credenciais em `description` ou `metadata`; registros de tarefa são visíveis para qualquer um com acesso à equipe.
- Depois da criação, mova a tarefa pelo seu ciclo de vida com `TaskUpdate`. Não deixe trabalho silenciosamente abandonado em `in_progress`.
