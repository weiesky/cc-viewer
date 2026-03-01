# TaskList

## Définition

Liste toutes les tâches dans la liste de tâches pour voir la progression globale et le travail disponible.

## Paramètres

Aucun paramètre.

## Contenu renvoyé

Informations résumées de chaque tâche :
- `id` — Identifiant de la tâche
- `subject` — Description brève
- `status` — Statut : `pending`, `in_progress` ou `completed`
- `owner` — Responsable (agent ID), vide signifie non assigné
- `blockedBy` — Liste des IDs de tâches incomplètes qui bloquent cette tâche

## Cas d'utilisation

**Adapté pour :**
- Voir quelles tâches sont disponibles (statut pending, sans owner, non bloquées)
- Vérifier la progression globale du projet
- Trouver les tâches bloquées
- Chercher la prochaine tâche après en avoir terminé une

## Notes

- Préférer traiter les tâches dans l'ordre des ID (ID le plus bas en premier), car les tâches antérieures fournissent généralement du contexte pour les suivantes
- Les tâches avec `blockedBy` ne peuvent pas être réclamées tant que les dépendances ne sont pas résolues
- Utiliser TaskGet pour obtenir les détails complets d'une tâche spécifique

## Signification dans cc-viewer

TaskList est une opération interne de gestion de tâches, elle ne produit pas de requêtes API indépendantes.

## Texte original

<textarea readonly>Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.
</textarea>
