# TaskUpdate

Modifie une tâche existante — son statut, son contenu, sa propriété, ses métadonnées ou ses arêtes de dépendance. C'est ainsi que les tâches progressent dans leur cycle de vie et que le travail est transféré entre Claude Code, les coéquipiers et les sous-agents.

## Quand l'utiliser

- Faire transiter une tâche dans le workflow de statut au fur et à mesure que vous y travaillez.
- Réclamer une tâche en vous attribuant (ou en attribuant à un autre agent) le rôle de `owner`.
- Affiner le `subject` ou la `description` une fois que vous en savez plus sur le problème.
- Enregistrer des dépendances nouvellement découvertes avec `addBlocks` / `addBlockedBy`.
- Attacher des `metadata` structurées telles que des IDs de tickets externes ou des indices de priorité.

## Activation

- Disponible par défaut sur la plupart des modèles.
- Non disponible sur les familles Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 et ultérieures (v2.1.233+) à moins d'une adhésion via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Tout le système de tâches est désactivé lorsque `CLAUDE_CODE_ENABLE_TASKS=false`.

## Paramètres

- `taskId` (string, requis) : la tâche à modifier. Obtenue depuis `TaskList` ou `TaskCreate`.
- `status` (string, optionnel) : un parmi `pending`, `in_progress`, `completed`, `deleted`.
- `subject` (string, optionnel) : titre impératif de remplacement.
- `description` (string, optionnel) : description détaillée de remplacement.
- `activeForm` (string, optionnel) : texte de spinner au présent continu de remplacement.
- `owner` (string, optionnel) : handle d'agent ou de coéquipier prenant la responsabilité de la tâche.
- `metadata` (object, optionnel) : clés de métadonnées à fusionner dans la tâche. Réglez une clé à `null` pour la supprimer.
- `addBlocks` (array de strings, optionnel) : IDs de tâches que cette tâche bloque.
- `addBlockedBy` (array de strings, optionnel) : IDs de tâches qui doivent se terminer avant celle-ci.

## Workflow de statut

Le cycle de vie est délibérément linéaire : `pending` → `in_progress` → `completed`. `deleted` est terminal et utilisé pour retirer les tâches qui ne seront jamais traitées.

- Passez à `in_progress` au moment où vous commencez réellement le travail, pas avant. Une seule tâche à la fois doit être `in_progress` pour un propriétaire donné.
- Passez à `completed` uniquement lorsque le travail est entièrement terminé — critères d'acceptation remplis, tests passants, sortie écrite. Si un bloqueur apparaît, gardez la tâche `in_progress` et ajoutez une nouvelle tâche décrivant ce qui doit être résolu.
- Ne marquez jamais une tâche `completed` lorsque les tests échouent, que l'implémentation est partielle ou que vous rencontrez des erreurs non résolues.
- Utilisez `deleted` pour les tâches annulées ou en double ; ne recyclez pas une tâche pour un travail sans rapport.

## Exemples

### Exemple 1

Réclamer une tâche et la démarrer.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### Exemple 2

Terminer le travail et enregistrer une dépendance de suivi.

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## Notes

- `metadata` fusionne clé par clé ; passer `null` pour une clé la supprime. Appelez `TaskGet` d'abord si vous n'êtes pas sûr du contenu actuel.
- `addBlocks` et `addBlockedBy` ajoutent des arêtes ; ils ne suppriment pas les existantes. Éditer le graphe de manière destructive nécessite un workflow dédié — consultez le propriétaire de l'équipe avant de réécrire les dépendances.
- Gardez `activeForm` synchronisé lorsque vous modifiez `subject` afin que le texte du spinner continue de se lire naturellement.
- Ne marquez pas une tâche `completed` pour la faire taire. Si l'utilisateur a annulé le travail, utilisez `deleted` avec un bref justificatif dans `description`.
- Lisez l'état le plus récent d'une tâche avec `TaskGet` avant de la mettre à jour — les coéquipiers peuvent l'avoir modifiée entre votre dernière lecture et votre écriture.
