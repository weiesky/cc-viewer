# ExitPlanMode

## Definição

Sai do modo de planejamento e submete o plano para aprovação do usuário. O conteúdo do plano é lido do arquivo de plano previamente escrito.

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `allowedPrompts` | array | Não | Lista de descrições de permissões necessárias para o plano de implementação |

Cada elemento do array `allowedPrompts`:

| Campo | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `tool` | enum | Sim | Ferramenta aplicável, atualmente suporta apenas `Bash` |
| `prompt` | string | Sim | Descrição semântica da operação (ex: "run tests", "install dependencies") |

## Cenários de Uso

**Adequado para:**
- No modo de planejamento, quando o plano está completo e pronto para submissão à aprovação do usuário
- Usado apenas para tarefas de implementação que requerem escrita de código

**Não adequado para:**
- Tarefas puramente de pesquisa/exploração — não é necessário sair do modo de planejamento
- Querer perguntar ao usuário "o plano está ok?" — esta é exatamente a função desta ferramenta, não use AskUserQuestion para isso

## Observações

- Esta ferramenta não aceita o conteúdo do plano como parâmetro — ela lê do arquivo de plano previamente escrito
- O usuário verá o conteúdo do arquivo de plano para aprovação
- Não use AskUserQuestion para perguntar "o plano está ok?" antes de chamar esta ferramenta, isso é redundante
- Não mencione "plano" nas perguntas, pois o usuário não pode ver o conteúdo do plano antes do ExitPlanMode

## Significado no cc-viewer

A chamada ExitPlanMode marca o fim da fase de planejamento. Nos logs de requisição, as requisições após esta chamada tipicamente mudam para operações de implementação (Edit, Write, Bash, etc.).

## Texto original

<textarea readonly>Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
</textarea>
