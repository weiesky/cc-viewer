# TodoWrite

Écrit une liste de tâches structurée pour la session courante, en remplaçant la liste précédente. Chaque élément porte son texte, un statut et une forme au présent continu affichée dans les indicateurs de progression.

## Quand l'utiliser

- Une tâche comporte plusieurs étapes distinctes et leur suivi vous aide (vous et l'utilisateur) à voir la progression.
- L'utilisateur demande explicitement une liste de tâches.
- Vous voulez marquer exactement un élément comme en cours pendant que le reste demeure en attente ou terminé.

## Paramètres

- `todos` (array, requis) : la liste de tâches complète et mise à jour. Chaque entrée contient :
  - `content` (string) : la description de la tâche.
  - `status` (string) : l'une des valeurs `pending`, `in_progress`, `completed`.
  - `activeForm` (string) : texte au présent continu affiché tant que l'élément est en cours (p. ex. "Running tests").

## Exemples

### Exemple 1 : suivre un changement en trois étapes

```
TodoWrite(
  todos=[
    {content="Update the parser", status="in_progress", activeForm="Updating the parser"},
    {content="Add unit tests", status="pending", activeForm="Adding unit tests"},
    {content="Run the full test suite", status="pending", activeForm="Running the full test suite"}
  ]
)
```

La liste entière est réécrite à chaque appel — incluez toujours tous les éléments, pas seulement ceux qui ont changé.

## Notes

- La liste est remplacée en bloc à chaque appel ; pour mettre à jour un élément, resoumettez tous les éléments avec le nouveau statut.
- Gardez exactement un élément `in_progress` à la fois.
- Dans les sessions où les outils de tâches structurées (`TaskCreate`/`TaskUpdate`/`TaskList`) sont activés, le harnais peut proposer ceux-ci à la place de `TodoWrite` — préférez le jeu d'outils annoncé.
