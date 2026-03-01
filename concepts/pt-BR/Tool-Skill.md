# Skill

## Definição

Executa uma skill (habilidade) na conversa principal. Skills são capacidades especializadas que o usuário pode invocar através de slash commands (ex: `/commit`, `/review-pr`).

## Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
|------|------|------|------|
| `skill` | string | Sim | Nome da skill (ex: "commit", "review-pr", "pdf") |
| `args` | string | Não | Argumentos da skill |

## Cenários de Uso

**Adequado para:**
- O usuário digitou um slash command no formato `/<skill-name>`
- A solicitação do usuário corresponde à funcionalidade de uma skill registrada

**Não adequado para:**
- Comandos CLI integrados (ex: `/help`, `/clear`)
- Skills que já estão em execução
- Nomes de skills que não estão na lista de skills disponíveis

## Observações

- Após ser invocada, a skill se expande em um prompt completo
- Suporta nomes totalmente qualificados (ex: `ms-office-suite:pdf`)
- A lista de skills disponíveis é fornecida nas mensagens system-reminder
- Quando a tag `<command-name>` é vista, significa que a skill já foi carregada e deve ser executada diretamente sem chamar esta ferramenta novamente
- Não mencione uma skill sem realmente invocar a ferramenta

## Significado no cc-viewer

A chamada Skill aparece nos logs de requisição como um content block `tool_use`. O prompt expandido pela skill afeta o system prompt ou conteúdo das mensagens das requisições subsequentes.

## Texto original

<textarea readonly>Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
</textarea>
