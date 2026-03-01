# ExitPlanMode

## Définition

Quitte le mode planification et soumet le plan à l'utilisateur pour approbation. Le contenu du plan est lu à partir du fichier de plan écrit précédemment.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `allowedPrompts` | array | Non | Liste des descriptions de permissions nécessaires pour implémenter le plan |

Chaque élément du tableau `allowedPrompts` :

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `tool` | enum | Oui | Outil applicable, actuellement seul `Bash` est supporté |
| `prompt` | string | Oui | Description sémantique de l'opération (comme « run tests », « install dependencies ») |

## Cas d'utilisation

**Adapté pour :**
- Le plan est terminé en mode planification, prêt à être soumis pour approbation de l'utilisateur
- Uniquement pour les tâches d'implémentation nécessitant l'écriture de code

**Non adapté pour :**
- Tâches purement de recherche/exploration — pas besoin de quitter le mode planification
- Vouloir demander à l'utilisateur « le plan est-il correct ? » — c'est exactement la fonction de cet outil, ne pas utiliser AskUserQuestion pour cela

## Notes

- Cet outil n'accepte pas le contenu du plan comme paramètre — il le lit à partir du fichier de plan écrit précédemment
- L'utilisateur verra le contenu du fichier de plan pour l'approuver
- Ne pas utiliser AskUserQuestion pour demander « le plan est-il correct ? » avant d'appeler cet outil, c'est redondant
- Ne pas mentionner « plan » dans les questions, car l'utilisateur ne peut pas voir le contenu du plan avant ExitPlanMode

## Signification dans cc-viewer

L'appel à ExitPlanMode marque la fin de la phase de planification. Dans le journal des requêtes, les requêtes après cet appel se transforment généralement en opérations d'implémentation (Edit, Write, Bash, etc.).

## Texte original

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
