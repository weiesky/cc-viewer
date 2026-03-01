# TaskOutput

## Définition

Obtient la sortie des tâches en arrière-plan en cours d'exécution ou terminées. Applicable aux shells en arrière-plan, agents asynchrones et sessions distantes.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `task_id` | string | Oui | ID de la tâche |
| `block` | boolean | Oui | Si l'on bloque en attendant la fin de la tâche, par défaut `true` |
| `timeout` | number | Oui | Temps d'attente maximum (millisecondes), par défaut 30000, maximum 600000 |

## Cas d'utilisation

**Adapté pour :**
- Vérifier la progression des agents en arrière-plan lancés via Task (`run_in_background: true`)
- Obtenir les résultats d'exécution de commandes Bash en arrière-plan
- Attendre qu'une tâche asynchrone se termine et obtenir sa sortie

**Non adapté pour :**
- Tâches au premier plan — les tâches au premier plan renvoient directement les résultats, cet outil n'est pas nécessaire

## Notes

- `block: true` bloque jusqu'à ce que la tâche se termine ou que le délai expire
- `block: false` est utilisé pour une vérification non bloquante de l'état actuel
- L'ID de la tâche peut être trouvé via la commande `/tasks`
- Applicable à tous les types de tâches : shells en arrière-plan, agents asynchrones, sessions distantes

## Signification dans cc-viewer

Les appels TaskOutput ne produisent pas de requêtes API en eux-mêmes, c'est une opération interne de gestion de tâches de Claude Code et n'apparaît pas dans le journal des requêtes.

## Texte original

<textarea readonly>- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions</textarea>
