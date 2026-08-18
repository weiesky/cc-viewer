# TaskList

Renvoie toutes les tâches de l'équipe courante (ou de la session) sous forme résumée. Utilisez-le pour passer en revue le travail en cours, décider quoi prendre ensuite et éviter de créer des doublons.

## Quand l'utiliser

- Au début d'une session pour voir ce qui est déjà suivi.
- Avant d'appeler `TaskCreate`, pour confirmer que le travail n'est pas déjà capturé.
- Lorsque vous décidez quelle tâche réclamer ensuite en tant que coéquipier ou sous-agent.
- Pour vérifier les relations de dépendance au sein de l'équipe d'un coup d'œil.
- Périodiquement pendant de longues sessions pour resynchroniser avec des coéquipiers qui ont pu réclamer, terminer ou ajouter des tâches.

`TaskList` est en lecture seule et peu coûteux ; appelez-le librement chaque fois que vous avez besoin d'une vue d'ensemble.

## Activation

- Disponible par défaut sur la plupart des modèles.
- Non disponible sur les familles Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 et ultérieures (v2.1.233+) à moins d'une adhésion via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Tout le système de tâches est désactivé lorsque `CLAUDE_CODE_ENABLE_TASKS=false`.

## Paramètres

`TaskList` ne prend aucun paramètre. Il renvoie toujours l'ensemble complet des tâches pour le contexte actif.

## Forme de la réponse

Chaque tâche de la liste est un résumé, pas l'enregistrement complet. Attendez-vous à peu près à :

- `id` — identifiant stable à utiliser avec `TaskGet` / `TaskUpdate`.
- `subject` — titre court à l'impératif.
- `status` — un parmi `pending`, `in_progress`, `completed`, `deleted`.
- `owner` — identifiant d'agent ou de coéquipier, ou vide lorsqu'aucune propriété.
- `blockedBy` — tableau d'IDs de tâches qui doivent se terminer d'abord.

Pour la description complète, les critères d'acceptation ou les métadonnées d'une tâche spécifique, enchaînez avec `TaskGet`.

## Exemples

### Exemple 1

Vérification de statut rapide.

```
TaskList()
```

Parcourez la sortie pour repérer tout ce qui est `in_progress` sans `owner` (travail stagnant) et tout ce qui est `pending` avec un `blockedBy` vide (prêt à être pris).

### Exemple 2

Un coéquipier choisit la prochaine tâche.

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## Notes

- Heuristique de coéquipier : lorsque plusieurs tâches `pending` sont débloquées et sans propriétaire, prenez le plus petit ID. Cela maintient le travail en FIFO et évite que deux agents ne s'emparent de la même tâche très visible.
- Respectez `blockedBy` : ne commencez pas une tâche dont les bloqueurs sont encore `pending` ou `in_progress`. Travaillez d'abord le bloqueur ou coordonnez-vous avec son propriétaire.
- `TaskList` est le seul mécanisme de découverte des tâches. Il n'y a pas de recherche ; si la liste est longue, parcourez-la structurellement (par statut, puis par propriétaire).
- Les tâches supprimées peuvent encore apparaître dans la liste avec le statut `deleted` pour la traçabilité. Ignorez-les à des fins de planification.
- La liste reflète l'état en direct de l'équipe, donc les coéquipiers peuvent ajouter ou réclamer des tâches entre les appels. Relistez avant de réclamer si du temps s'est écoulé.
