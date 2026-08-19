# Agent

Lance un sous-agent Claude Code autonome avec sa propre fenêtre de contexte pour traiter une tâche ciblée et renvoyer un unique résultat consolidé. C'est le mécanisme canonique pour déléguer de la recherche ouverte, du travail parallèle ou de la collaboration en équipe.

## Quand l'utiliser

- Recherches ouvertes lorsque vous ne savez pas encore quels fichiers sont pertinents et que vous anticipez plusieurs tours de `Glob`, `Grep` et `Read`.
- Travail parallèle indépendant — lancez plusieurs agents dans un même message pour explorer simultanément des zones distinctes.
- Isoler une exploration bruyante de la conversation principale afin que le contexte parent reste compact.
- Déléguer à un type de sous-agent spécialisé tel que `Explore`, `Plan`, `claude-code-guide` ou `statusline-setup`.
- Faire apparaître un coéquipier nommé dans une équipe active pour un travail coordonné entre plusieurs agents.

N'utilisez PAS `Agent` lorsque le fichier ou le symbole cible est déjà connu — utilisez directement `Read`, `Grep` ou `Glob`. Une recherche en une seule étape via `Agent` gaspille une fenêtre de contexte entière et ajoute de la latence.

## Paramètres

- `description` (string, requis) : libellé court de 3 à 5 mots décrivant la tâche ; affiché dans l'interface et les journaux.
- `prompt` (string, requis) : briefing complet et autonome que l'agent exécutera. Doit inclure tout le contexte nécessaire, les contraintes et le format de retour attendu.
- `subagent_type` (string, optionnel) : persona prédéfinie telle que `general-purpose`, `Explore`, `Plan`, `claude-code-guide` ou `statusline-setup`. Par défaut `general-purpose`.
- `run_in_background` (boolean, optionnel) : si `true`, l'agent s'exécute de façon asynchrone et le parent peut continuer à travailler ; les résultats sont récupérés ultérieurement.
- `model` (string, optionnel) : remplace le modèle pour cet agent — `opus`, `sonnet` ou `haiku`. Par défaut, le modèle de la session parente.
- `isolation` (string, optionnel) : définir à `worktree` pour exécuter l'agent dans un worktree git isolé afin que ses écritures sur le système de fichiers n'entrent pas en conflit avec celles du parent.
- `team_name` (string, optionnel) : lors du lancement dans une équipe existante, l'identifiant de l'équipe que l'agent rejoindra.
- `name` (string, optionnel) : nom d'adressage du coéquipier au sein de l'équipe, utilisé comme cible `to` pour `SendMessage`.

## Exemples

### Exemple 1 : recherche de code ouverte

```
Agent(
  description="Find auth middleware",
  subagent_type="Explore",
  prompt="Locate every place in this repo where JWT verification is performed. Return a bulleted list of absolute file paths with a one-line note about each site's role. Do not modify any files."
)
```

### Exemple 2 : investigations indépendantes parallèles

Lancez deux agents dans le même message — l'un inspecte le pipeline de build, l'autre examine le harnais de tests. Chacun dispose de sa propre fenêtre de contexte et renvoie un résumé. Les regrouper dans un unique bloc d'appels d'outils les exécute en parallèle.

### Exemple 3 : ajouter un coéquipier à une équipe en cours

```
Agent(
  description="Data layer specialist",
  team_name="refactor-crew",
  name="db-lead",
  prompt="You are db-lead on team refactor-crew. Audit all Prisma schema files and propose a migration plan. Use SendMessage to report findings to the team leader."
)
```

## Notes

- Les agents n'ont aucun souvenir des exécutions précédentes. Chaque invocation part de zéro, donc le `prompt` doit être entièrement autonome — incluez les chemins de fichiers, les conventions, la question et la forme exacte de la réponse souhaitée.
- L'agent renvoie exactement un message final. Il ne peut pas poser de questions de clarification en cours d'exécution, donc toute ambiguïté dans le prompt se traduit par des approximations dans le résultat.
- Exécuter plusieurs agents en parallèle est bien plus rapide que des appels séquentiels lorsque les sous-tâches sont indépendantes. Regroupez-les dans un même bloc d'appels d'outils.
- Utilisez `isolation: "worktree"` chaque fois qu'un agent écrit des fichiers et que vous souhaitez examiner les changements avant de les fusionner dans l'arbre de travail principal.
- Préférez `subagent_type: "Explore"` pour la reconnaissance en lecture seule et `Plan` pour le travail de conception ; `general-purpose` est la valeur par défaut pour les tâches mixtes lecture/écriture.
- Les agents en arrière-plan (`run_in_background: true`) conviennent aux tâches longues ; évitez les boucles de polling avec `sleep` — le parent est notifié à la fin.
