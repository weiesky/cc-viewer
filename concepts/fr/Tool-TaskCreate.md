# TaskCreate

Crée une nouvelle tâche dans la liste de tâches de l'équipe courante (ou la liste de tâches de la session lorsqu'aucune équipe n'est active). Utilisez-le pour capturer des éléments de travail à suivre, déléguer ou reprendre plus tard.

## Quand l'utiliser

- L'utilisateur décrit un travail en plusieurs étapes qui bénéficie d'un suivi explicite.
- Vous décomposez une grosse requête en unités plus petites réalisables séparément.
- Un suivi est découvert en cours de tâche et ne doit pas être oublié.
- Vous avez besoin d'une trace durable de l'intention avant de confier le travail à un coéquipier ou à un sous-agent.
- Vous opérez en mode plan et souhaitez que chaque étape du plan soit représentée comme une tâche concrète.

Sautez `TaskCreate` pour les actions triviales en un coup, la pure conversation ou tout ce qui est réalisable en deux ou trois appels d'outil directs.

## Activation

- Disponible par défaut sur la plupart des modèles.
- Non disponible sur les familles Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 et ultérieures (v2.1.233+) à moins d'une adhésion via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `--allowedTools` ou `--tools`.
- Tout le système de tâches est désactivé lorsque `CLAUDE_CODE_ENABLE_TASKS=false`.

## Paramètres

- `subject` (string, requis) : titre court à l'impératif, par exemple `Fix login redirect on Safari`. Gardez-le sous environ quatre-vingts caractères.
- `description` (string, requis) : contexte détaillé — le problème, les contraintes, les critères d'acceptation et les fichiers ou liens dont un futur lecteur aura besoin. Écrivez comme si un coéquipier allait reprendre cela à froid.
- `activeForm` (string, optionnel) : texte de spinner au présent continu affiché tant que la tâche est `in_progress`, par exemple `Fixing login redirect on Safari`. Reflète le `subject` mais à la forme en -ing.
- `metadata` (object, optionnel) : données structurées arbitraires attachées à la tâche. Usages courants : libellés, indices de priorité, IDs de tickets externes ou configuration spécifique à l'agent.

Les tâches nouvellement créées commencent toujours avec le statut `pending` et sans propriétaire. Les dépendances (`blocks`, `blockedBy`) ne sont pas définies à la création — appliquez-les ensuite avec `TaskUpdate`.

## Exemples

### Exemple 1

Capturer un rapport de bug que l'utilisateur vient de déposer.

```
TaskCreate(
  subject: "Repair broken PDF export on Windows",
  description: "Users on Windows 11 report the export button produces a 0-byte file. Reproduce with sample doc in test/fixtures/export/, then fix the code path in src/export/pdf.ts. Acceptance: export writes a valid PDF and the existing export test suite passes.",
  activeForm: "Repairing broken PDF export on Windows"
)
```

### Exemple 2

Découper une épopée en unités suivies au début d'une session.

```
TaskCreate(
  subject: "Draft migration plan for auth service",
  description: "Produce a written plan covering rollout stages, rollback strategy, and monitoring. Output: docs/auth-migration.md.",
  activeForm: "Drafting migration plan for auth service",
  metadata: { "priority": "P1", "linearId": "AUTH-214" }
)
```

## Notes

- Écrivez le `subject` à la voix impérative et le `activeForm` au présent continu afin que l'interface se lise naturellement lorsque la tâche passe à `in_progress`.
- Appelez `TaskList` avant de créer pour éviter les doublons — la liste d'équipe est partagée avec les coéquipiers et sous-agents.
- N'incluez pas de secrets ou d'identifiants dans `description` ou `metadata` ; les enregistrements de tâches sont visibles à toute personne ayant accès à l'équipe.
- Après la création, faites progresser la tâche dans son cycle de vie avec `TaskUpdate`. Ne laissez pas du travail silencieusement abandonné en `in_progress`.
