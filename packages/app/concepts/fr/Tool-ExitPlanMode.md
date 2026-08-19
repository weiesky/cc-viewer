# ExitPlanMode

Soumet le plan d'implémentation rédigé pendant le mode plan pour approbation de l'utilisateur et — s'il est approuvé — fait sortir la session du mode plan afin que les modifications puissent commencer.

## Quand l'utiliser

- Un plan rédigé pendant `EnterPlanMode` est complet et prêt à être examiné.
- La tâche est orientée implémentation (changements de code ou de configuration), et non pure recherche, donc un plan explicite est approprié.
- Toutes les lectures et analyses préalables ont été effectuées ; aucune investigation supplémentaire n'est nécessaire avant que l'utilisateur ne se prononce.
- L'assistant a énuméré des chemins de fichiers, des fonctions et des étapes concrètes — pas seulement des objectifs.
- L'utilisateur a demandé à voir le plan, ou le workflow en mode plan s'apprête à passer la main aux outils d'édition.

## Paramètres

- `allowedPrompts` (array, optionnel) : invites que l'utilisateur peut saisir sur l'écran d'approbation pour approuver automatiquement ou modifier le plan. Chaque élément spécifie une permission limitée (par exemple un nom d'opération et l'outil auquel elle s'applique). Laissez non défini pour utiliser le flux d'approbation par défaut.

## Exemples

### Exemple 1 : soumission standard

Après avoir étudié un refactoring d'authentification en mode plan et écrit le fichier du plan sur disque, l'assistant appelle `ExitPlanMode` sans arguments. Le harnais lit le plan depuis son emplacement canonique, l'affiche à l'utilisateur et attend approbation ou rejet.

### Exemple 2 : actions rapides pré-approuvées

```
ExitPlanMode(allowedPrompts=[
  {"tool": "Bash", "prompt": "run tests"},
  {"tool": "Bash", "prompt": "install dependencies"}
])
```

Permet à l'utilisateur d'accorder d'avance la permission pour des commandes de suivi courantes, afin que l'assistant n'ait pas besoin de s'interrompre pour chaque invite de permission pendant l'implémentation.

## Notes

- `ExitPlanMode` n'a de sens que pour un travail de type implémentation. Si la demande de l'utilisateur est une tâche de recherche ou d'explication sans changement de fichier, répondez directement — ne passez pas par le mode plan juste pour en sortir.
- Le plan doit déjà être écrit sur disque avant d'appeler cet outil. `ExitPlanMode` n'accepte pas le corps du plan comme paramètre ; il lit depuis le chemin attendu par le harnais.
- Si l'utilisateur rejette le plan, vous retournez en mode plan. Révisez en fonction du retour et soumettez de nouveau ; ne commencez pas à éditer des fichiers tant que le plan n'est pas approuvé.
- L'approbation accorde la permission de sortir du mode plan et d'utiliser des outils mutatifs (`Edit`, `Write`, `Bash`, etc.) pour la portée décrite dans le plan. Élargir la portée par la suite nécessite un nouveau plan ou un consentement explicite de l'utilisateur.
- N'utilisez pas `AskUserQuestion` pour demander « ce plan vous convient-il ? » avant d'appeler cet outil — demander l'approbation du plan est exactement ce que fait `ExitPlanMode`, et l'utilisateur ne peut pas voir le plan tant qu'il n'est pas soumis.
- Gardez le plan minimal et actionnable. Un relecteur doit pouvoir le parcourir en moins d'une minute et comprendre exactement ce qui va changer.
- Si vous réalisez en cours d'implémentation que le plan était erroné, arrêtez-vous et faites un rapport à l'utilisateur plutôt que de dévier silencieusement. Rentrer en mode plan est une étape suivante valide.
