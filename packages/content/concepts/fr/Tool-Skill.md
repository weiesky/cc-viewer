# Skill

Invoque une skill nommée au sein de la conversation en cours. Les skills sont des ensembles de capacités pré-packagés — connaissances de domaine, workflows et parfois accès à des outils — que le harnais expose à l'assistant via des rappels système.

## Quand l'utiliser

- L'utilisateur tape une commande slash telle que `/review` ou `/init` — les commandes slash sont des skills et doivent être exécutées via cet outil.
- L'utilisateur décrit une tâche qui correspond aux conditions de déclenchement d'une skill annoncée (par exemple, demander de scanner les transcriptions pour des invites de permission répétées correspond à `fewer-permission-prompts`).
- L'objectif déclaré d'une skill correspond directement au fichier, à la requête ou au contexte de conversation courant.
- Des workflows spécialisés et répétables sont disponibles sous forme de skills et la procédure canonique est préférable à une approche ad hoc.
- L'utilisateur demande « quelles skills sont disponibles » — listez les noms annoncés, et n'invoquez que lorsqu'il confirme.

## Paramètres

- `skill` (string, requis) : le nom exact d'une skill listée dans le rappel système des skills disponibles. Pour les skills avec un espace de noms de plugin, utilisez la forme pleinement qualifiée `plugin:skill` (par exemple `skill-creator:skill-creator`). N'incluez pas de slash initial.
- `args` (string, optionnel) : arguments libres passés à la skill. Le format et la sémantique sont définis par la documentation de chaque skill.

## Exemples

### Exemple 1 : exécuter une skill de revue sur la branche courante

```
Skill(skill="review")
```

La skill `review` encapsule les étapes de revue d'une pull request par rapport à la branche de base courante. L'invoquer charge la procédure de revue définie par le harnais dans le tour.

### Exemple 2 : invoquer une skill avec espace de noms de plugin avec des arguments

```
Skill(
  skill="skill-creator:skill-creator",
  args="create a skill that summarizes git log for a given date range"
)
```

Achemine la requête via le point d'entrée du plugin `skill-creator` afin que le workflow de création se déclenche.

## Notes

- N'invoquez que les skills dont les noms apparaissent textuellement dans le rappel système des skills disponibles, ou les skills que l'utilisateur a tapées directement en tant que `/name` dans son message. Ne devinez ni n'inventez jamais des noms de skill à partir de la mémoire ou des données d'entraînement — si la skill n'est pas annoncée, n'appelez pas cet outil.
- Lorsqu'une requête de l'utilisateur correspond à une skill annoncée, appeler `Skill` est un prérequis bloquant : invoquez-la avant de générer toute autre réponse sur la tâche. Ne décrivez pas ce que ferait la skill — exécutez-la.
- Ne mentionnez jamais une skill par son nom sans l'invoquer réellement. Annoncer une skill sans appeler l'outil est trompeur.
- N'utilisez pas `Skill` pour les commandes CLI intégrées telles que `/help`, `/clear`, `/model` ou `/exit`. Celles-ci sont gérées directement par le harnais.
- Ne réinvoquez pas une skill déjà en cours d'exécution dans le tour courant. Si vous voyez une balise `<command-name>` dans le tour courant, la skill a déjà été chargée — suivez ses instructions en place plutôt que de rappeler l'outil.
- Si plusieurs skills peuvent s'appliquer, choisissez la plus spécifique. Pour les changements de configuration tels que l'ajout de permissions ou de hooks, préférez `update-config` à une approche de paramètres générique.
- L'exécution d'une skill peut introduire de nouveaux rappels système, outils ou contraintes pour le reste du tour. Relisez l'état de la conversation après qu'une skill se termine avant de continuer.
