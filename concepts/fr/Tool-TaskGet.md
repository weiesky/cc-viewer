# TaskGet

## Définition

Obtient les détails complets d'une tâche via son ID.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `taskId` | string | Oui | ID de la tâche à obtenir |

## Contenu renvoyé

- `subject` — Titre de la tâche
- `description` — Exigences détaillées et contexte
- `status` — Statut : `pending`, `in_progress` ou `completed`
- `blocks` — Liste des tâches bloquées par cette tâche
- `blockedBy` — Liste des tâches préalables qui bloquent cette tâche

## Cas d'utilisation

**Adapté pour :**
- Obtenir la description complète et le contexte d'une tâche avant de commencer à travailler
- Comprendre les relations de dépendance d'une tâche
- Obtenir les exigences complètes après avoir été assigné à une tâche

## Notes

- Après avoir obtenu la tâche, vérifier si la liste `blockedBy` est vide avant de commencer à travailler
- Utiliser TaskList pour voir les informations résumées de toutes les tâches

## Signification dans cc-viewer

TaskGet est une opération interne de gestion de tâches, elle ne produit pas de requêtes API indépendantes.

## Texte original

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
