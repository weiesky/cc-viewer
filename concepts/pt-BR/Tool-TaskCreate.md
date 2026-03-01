# TaskCreate

## Definição

Cria entradas estruturadas na lista de tarefas, para rastrear progresso, organizar tarefas complexas e mostrar o andamento do trabalho ao usuário.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `subject` | string | Sim | Título curto da tarefa, usar forma imperativa (ex: "Fix authentication bug") |
| `description` | string | Sim | Descrição detalhada, incluindo contexto e critérios de aceitação |
| `activeForm` | string | Não | Texto no gerúndio exibido quando em andamento (ex: "Fixing authentication bug") |
| `metadata` | object | Não | Metadados arbitrários anexados à tarefa |

## Cenários de Uso

**Adequado para:**
- Tarefas complexas de múltiplas etapas (mais de 3 etapas)
- O usuário forneceu múltiplos itens a fazer
- Rastrear trabalho no modo de planejamento
- O usuário solicitou explicitamente o uso de lista de tarefas

**Não adequado para:**
- Tarefa única e simples
- Operações simples de até 3 etapas
- Consultas puramente conversacionais ou informativas

## Observações

- Todas as tarefas criadas têm status inicial `pending`
- `subject` usa forma imperativa ("Run tests"), `activeForm` usa gerúndio ("Running tests")
- Após criar a tarefa, pode-se definir dependências (blocks/blockedBy) via TaskUpdate
- Antes de criar, deve-se chamar TaskList para verificar se há tarefas duplicadas

## Significado no cc-viewer

TaskCreate é uma operação interna de gerenciamento de tarefas do Claude Code, não gera requisições API independentes. Porém, no Chat Mode é possível ver o bloco tool_use do modelo chamando esta ferramenta.

## Texto original

<textarea readonly>Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
</textarea>
