# TaskCreate

## Définition

Crée des entrées structurées dans la liste de tâches pour suivre la progression, organiser des tâches complexes et montrer l'avancement du travail à l'utilisateur.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `subject` | string | Oui | Titre bref de la tâche, utiliser la forme impérative (comme « Fix authentication bug ») |
| `description` | string | Oui | Description détaillée, incluant le contexte et les critères d'acceptation |
| `activeForm` | string | Non | Texte au participe présent affiché quand la tâche est en cours (comme « Fixing authentication bug ») |
| `metadata` | object | Non | Métadonnées arbitraires attachées à la tâche |

## Cas d'utilisation

**Adapté pour :**
- Tâches complexes multi-étapes (plus de 3 étapes)
- L'utilisateur a fourni plusieurs éléments à faire
- Suivre le travail en mode planification
- L'utilisateur demande explicitement d'utiliser une liste de tâches

**Non adapté pour :**
- Une seule tâche simple
- Opérations simples de 3 étapes ou moins
- Requêtes purement conversationnelles ou informatives

## Notes

- Toutes les nouvelles tâches ont le statut initial `pending`
- `subject` utilise la forme impérative (« Run tests »), `activeForm` utilise le participe présent (« Running tests »)
- Après la création de la tâche, les relations de dépendance (blocks/blockedBy) peuvent être établies via TaskUpdate
- Avant de créer, appeler TaskList pour vérifier s'il y a des tâches en double

## Signification dans cc-viewer

TaskCreate est une opération interne de gestion de tâches de Claude Code, elle ne produit pas de requêtes API indépendantes. Cependant, dans le Chat Mode, on peut voir le bloc tool_use où le modèle appelle cet outil.

## Texte original

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
