# AskUserQuestion

Présente à l'utilisateur une ou plusieurs questions structurées à choix multiples dans l'interface de chat, collecte ses sélections et les renvoie à l'assistant — utile pour lever une ambiguïté d'intention sans échange libre.

## Quand l'utiliser

- Une requête admet plusieurs interprétations raisonnables et l'assistant a besoin que l'utilisateur en choisisse une avant de poursuivre.
- L'utilisateur doit choisir parmi des options concrètes (framework, bibliothèque, chemin de fichier, stratégie) où des réponses en texte libre seraient sources d'erreurs.
- Vous souhaitez comparer côte à côte des alternatives grâce au volet de prévisualisation.
- Plusieurs décisions liées peuvent être regroupées dans une seule invite pour réduire les allers-retours.
- Un plan ou un appel d'outil dépend d'une configuration que l'utilisateur n'a pas encore précisée.

## Paramètres

- `questions` (array, requis) : de une à quatre questions affichées ensemble dans une même invite. Chaque objet question contient :
  - `question` (string, requis) : le texte complet de la question, terminé par un point d'interrogation.
  - `header` (string, requis) : une étiquette courte (au plus 12 caractères) rendue sous forme de puce au-dessus de la question.
  - `options` (array, requis) : de deux à quatre objets option. Chaque option possède un `label` (1 à 5 mots), une `description`, et une prévisualisation `markdown` optionnelle.
  - `multiSelect` (boolean, requis) : lorsque `true`, l'utilisateur peut sélectionner plusieurs options.

## Exemples

### Exemple 1 : choisir un framework unique

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Exemple 2 : prévisualisation côte à côte de deux mises en page

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Notes

- L'interface ajoute automatiquement une option de texte libre « Other » à chaque question. N'ajoutez pas vos propres entrées « Other », « None » ou « Custom » — cela dupliquerait l'échappatoire intégrée.
- Limitez chaque appel à un nombre de questions compris entre une et quatre, et chaque question à un nombre d'options compris entre deux et quatre. Tout dépassement est rejeté par le harnais.
- Si vous recommandez une option particulière, placez-la en premier et ajoutez « (Recommended) » à son libellé afin que l'interface mette en valeur le chemin préféré.
- Les prévisualisations via le champ `markdown` ne sont prises en charge que pour les questions à sélection unique. Utilisez-les pour des artefacts visuels tels que des mises en page ASCII, des extraits de code ou des diffs de configuration — pas pour de simples questions de préférence où un libellé et une description suffisent.
- Lorsqu'une option d'une question possède une valeur `markdown`, l'interface bascule vers une mise en page côte à côte avec la liste d'options à gauche et la prévisualisation à droite.
- N'utilisez pas `AskUserQuestion` pour demander « ce plan vous convient-il ? » — appelez plutôt `ExitPlanMode`, qui existe précisément pour l'approbation de plan. En mode plan, évitez également de mentionner « le plan » dans le texte de la question, car le plan n'est pas visible pour l'utilisateur tant que `ExitPlanMode` n'a pas été exécuté.
- N'utilisez pas cet outil pour demander des entrées sensibles ou libres telles que des clés API ou des mots de passe. Demandez plutôt dans le chat.
