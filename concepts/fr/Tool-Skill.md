# Skill

## Définition

Exécute une compétence (skill) dans la conversation principale. Les compétences sont des capacités spécialisées que l'utilisateur peut invoquer via des slash commands (comme `/commit`, `/review-pr`).

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `skill` | string | Oui | Nom de la compétence (comme « commit », « review-pr », « pdf ») |
| `args` | string | Non | Arguments de la compétence |

## Cas d'utilisation

**Adapté pour :**
- L'utilisateur a saisi un slash command au format `/<skill-name>`
- La demande de l'utilisateur correspond à la fonctionnalité d'une compétence enregistrée

**Non adapté pour :**
- Commandes CLI intégrées (comme `/help`, `/clear`)
- Une compétence déjà en cours d'exécution
- Noms de compétences absents de la liste des compétences disponibles

## Notes

- Après invocation, la compétence se déploie en un prompt complet
- Supporte les noms pleinement qualifiés (comme `ms-office-suite:pdf`)
- La liste des compétences disponibles est fournie dans les messages system-reminder
- Quand on voit une balise `<command-name>`, cela signifie que la compétence est déjà chargée et doit être exécutée directement plutôt que de rappeler cet outil
- Ne pas mentionner une compétence sans avoir réellement appelé l'outil

## Signification dans cc-viewer

Les appels Skill apparaissent dans le journal des requêtes comme des content blocks `tool_use`. Le prompt déployé de la compétence affecte le system prompt ou le contenu des messages des requêtes suivantes.

## Texte original

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
