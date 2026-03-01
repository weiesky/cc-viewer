# TaskStop

## Définition

Arrête une tâche en arrière-plan en cours d'exécution.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `task_id` | string | Non | ID de la tâche en arrière-plan à arrêter |
| `shell_id` | string | Non | Obsolète, utiliser `task_id` à la place |

## Cas d'utilisation

**Adapté pour :**
- Terminer des tâches de longue durée qui ne sont plus nécessaires
- Annuler des tâches en arrière-plan lancées par erreur

## Notes

- Renvoie un statut de succès ou d'échec
- Le paramètre `shell_id` est obsolète, utiliser `task_id`

## Signification dans cc-viewer

Les appels TaskStop ne produisent pas de requêtes API en eux-mêmes, ils font partie des opérations internes de gestion de tâches de Claude Code.

## Texte original

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
