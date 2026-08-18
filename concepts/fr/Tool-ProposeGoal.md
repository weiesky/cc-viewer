# ProposeGoal

Propose un objectif d'achèvement vérifiable pour la session. L'objectif est montré à l'utilisateur dans une boîte de dialogue d'approbation (par défaut) et, une fois défini, guide le reste de la conversation vers un résultat vérifiable.

## Quand l'utiliser

- La session a un état final concret qu'un évaluateur pourrait vérifier à partir de la conversation (p. ex. "all tests in test/auth pass").
- Vous voulez l'accord explicite de l'utilisateur sur ce que « terminé » signifie avant d'entreprendre un travail substantiel.
- Les propres mots de l'utilisateur ont déjà énoncé le résultat et vous voulez qu'il soit enregistré comme objectif de session.

## Paramètres

- `condition` (string, requis) : la condition d'achèvement, écrite de sorte qu'un évaluateur distinct puisse la vérifier à partir de la conversation (p. ex. "all tests in test/auth pass (bun test exits 0)"). Au maximum 500 caractères — l'utilisateur doit pouvoir lire la condition entière dans la boîte de dialogue d'approbation.
- `ask_user` (boolean, optionnel) : s'il faut demander l'approbation de l'utilisateur avant que l'objectif ne soit défini. Défaut true (une boîte de dialogue d'approbation est affichée). Mettez false UNIQUEMENT lorsque les propres mots de l'utilisateur dans cette conversation ont énoncé ce résultat comme ce qu'il veut ; l'objectif est alors défini directement avec un avis visible, et l'utilisateur peut l'effacer avec `/goal clear`.

## Exemples

### Exemple 1 : proposer un objectif adossé à des tests

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

L'utilisateur voit la condition dans une boîte de dialogue d'approbation et peut l'accepter, l'éditer ou la rejeter.

### Exemple 2 : adopter directement le résultat énoncé par l'utilisateur

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

Valable uniquement parce que l'utilisateur a explicitement énoncé ce résultat plus tôt dans la conversation.

## Notes

- Gardez `condition` courte et objectivement vérifiable — les objectifs vagues ("make it better") vont à l'encontre du but.
- `ask_user=false` est strictement limité aux résultats que l'utilisateur a lui-même énoncés ; tout le reste doit passer par la boîte de dialogue d'approbation.
