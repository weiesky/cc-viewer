# TaskGet

Récupère l'enregistrement complet d'une tâche unique par ID, y compris sa description, son statut actuel, son propriétaire, ses métadonnées et ses arêtes de dépendance. Utilisez-le lorsque le résumé renvoyé par `TaskList` ne suffit pas pour agir sur la tâche.

## Quand l'utiliser

- Vous avez récupéré une tâche dans `TaskList` et avez besoin de la description complète avant de commencer le travail.
- Vous êtes sur le point de marquer une tâche `completed` et souhaitez revérifier les critères d'acceptation.
- Vous devez inspecter quelles tâches celle-ci `blocks` ou par lesquelles elle est `blockedBy` afin de décider de la suite.
- Vous enquêtez sur l'historique — qui la possède, quelles métadonnées étaient attachées, quand elle a changé d'état.
- Un coéquipier ou une session antérieure a référencé un ID de tâche et vous avez besoin du contexte.

Préférez `TaskList` lorsque vous n'avez besoin que d'un balayage de haut niveau ; réservez `TaskGet` à l'enregistrement spécifique que vous prévoyez de lire attentivement ou de modifier.

## Activation

- Disponible par défaut sur la plupart des modèles.
- Non disponible sur les familles Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 et ultérieures (v2.1.233+) à moins d'une adhésion via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Tout le système de tâches est désactivé lorsque `CLAUDE_CODE_ENABLE_TASKS=false`.

## Paramètres

- `taskId` (string, requis) : l'identifiant de tâche renvoyé par `TaskCreate` ou `TaskList`. Les IDs sont stables pendant toute la durée de vie de la tâche.

## Exemples

### Exemple 1

Consulter une tâche que vous venez de voir dans la liste.

```
TaskGet(taskId: "t_01HXYZ...")
```

Champs de réponse typiques : `id`, `subject`, `description`, `activeForm`, `status`, `owner`, `blocks`, `blockedBy`, `metadata`, `createdAt`, `updatedAt`.

### Exemple 2

Résoudre les dépendances avant de commencer.

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## Notes

- `TaskGet` est en lecture seule et peut être appelé à plusieurs reprises sans danger ; il ne modifie ni statut ni propriété.
- Si `blockedBy` n'est pas vide et contient des tâches qui ne sont pas `completed`, ne commencez pas cette tâche — résolvez d'abord les bloqueurs (ou coordonnez-vous avec leur propriétaire).
- Le champ `description` peut être long. Lisez-le intégralement avant d'agir ; le survoler conduit à manquer des critères d'acceptation.
- Un `taskId` inconnu ou supprimé renvoie une erreur. Relancez `TaskList` pour récupérer un ID courant.
- Si vous êtes sur le point d'éditer une tâche, appelez `TaskGet` d'abord pour éviter d'écraser des champs qu'un coéquipier vient de modifier.
