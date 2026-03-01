# Skill

## Definizione

Esegue una skill (abilità) nella conversazione principale. Le skill sono capacità specializzate che l'utente può invocare tramite slash command (es. `/commit`, `/review-pr`).

## Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|------|------|------|------|
| `skill` | string | Sì | Nome della skill (es. "commit", "review-pr", "pdf") |
| `args` | string | No | Argomenti della skill |

## Scenari d'uso

**Adatto per:**
- L'utente ha inserito uno slash command nel formato `/<skill-name>`
- La richiesta dell'utente corrisponde alla funzionalità di una skill registrata

**Non adatto per:**
- Comandi CLI integrati (es. `/help`, `/clear`)
- Una skill già in esecuzione
- Nomi di skill non presenti nella lista delle skill disponibili

## Note

- Dopo l'invocazione, la skill viene espansa in un prompt completo
- Supporta nomi completamente qualificati (es. `ms-office-suite:pdf`)
- La lista delle skill disponibili è fornita nei messaggi system-reminder
- Quando si vede un tag `<command-name>`, significa che la skill è stata caricata e va eseguita direttamente senza richiamare nuovamente questo strumento
- Non menzionare una skill senza aver effettivamente invocato lo strumento

## Significato in cc-viewer

Le chiamate Skill appaiono nei log delle richieste come content block `tool_use`. Il prompt espanso dalla skill influenza il system prompt o il contenuto dei messaggi delle richieste successive.

## Testo originale

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
