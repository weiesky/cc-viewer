# TaskUpdate

## Définition

Met à jour le statut, le contenu ou les relations de dépendance d'une tâche dans la liste de tâches.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `taskId` | string | Oui | ID de la tâche à mettre à jour |
| `status` | enum | Non | Nouveau statut : `pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | Non | Nouveau titre |
| `description` | string | Non | Nouvelle description |
| `activeForm` | string | Non | Texte au participe présent affiché quand la tâche est en cours |
| `owner` | string | Non | Nouveau responsable de la tâche (nom de l'agent) |
| `metadata` | object | Non | Métadonnées à fusionner (définir à null pour supprimer une clé) |
| `addBlocks` | string[] | Non | Liste des IDs de tâches bloquées par cette tâche |
| `addBlockedBy` | string[] | Non | Liste des IDs de tâches préalables qui bloquent cette tâche |

## Flux de statuts

```
pending → in_progress → completed
```

`deleted` peut être atteint depuis n'importe quel statut, supprime définitivement la tâche.

## Cas d'utilisation

**Adapté pour :**
- Marquer une tâche comme `in_progress` au début du travail
- Marquer une tâche comme `completed` à la fin du travail
- Établir des relations de dépendance entre les tâches
- Mettre à jour le contenu de la tâche quand les exigences changent

**Règles importantes :**
- Ne marquer comme `completed` que lorsque la tâche est entièrement terminée
- Garder comme `in_progress` en cas d'erreurs ou de blocages
- Ne pas marquer comme `completed` quand les tests échouent, l'implémentation est partielle ou des erreurs non résolues existent

## Notes

- Avant de mettre à jour, obtenir le statut le plus récent de la tâche via TaskGet pour éviter les données obsolètes
- Après avoir terminé une tâche, appeler TaskList pour trouver la prochaine tâche disponible

## Signification dans cc-viewer

TaskUpdate est une opération interne de gestion de tâches, elle ne produit pas de requêtes API indépendantes.

## Texte original

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
