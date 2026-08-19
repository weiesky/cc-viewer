# EnterWorktree

Crée un worktree Git isolé sur une nouvelle branche, ou bascule la session dans un worktree existant du dépôt courant, afin qu'un travail parallèle ou expérimental puisse se dérouler sans toucher au checkout principal.

## Quand l'utiliser

- L'utilisateur dit explicitement « worktree » — par exemple « start a worktree », « create a worktree » ou « work in a worktree ».
- Les instructions du projet dans `CLAUDE.md` ou la mémoire persistante vous indiquent d'utiliser un worktree pour la tâche en cours.
- Vous souhaitez poursuivre une tâche précédemment configurée en tant que worktree (passez `path` pour y rentrer).
- Plusieurs branches expérimentales doivent coexister sur le disque sans bascule constante de checkout.
- Une tâche de longue durée doit être isolée des modifications sans rapport dans l'arbre de travail principal.

## Paramètres

- `name` (string, optionnel) : nom pour un nouveau répertoire de worktree. Chaque segment séparé par `/` ne peut contenir que des lettres, chiffres, points, underscores et tirets ; la chaîne complète est plafonnée à 64 caractères. Si omis et que `path` est également omis, un nom aléatoire est généré. Mutuellement exclusif avec `path`.
- `path` (string, optionnel) : chemin de système de fichiers d'un worktree existant du dépôt courant dans lequel basculer. Doit apparaître dans `git worktree list` pour ce dépôt ; les chemins qui ne sont pas des worktrees enregistrés du dépôt courant sont rejetés. Mutuellement exclusif avec `name`.

## Exemples

### Exemple 1 : créer un nouveau worktree avec un nom descriptif

```
EnterWorktree(name="feat/okta-sso")
```

Crée `.claude/worktrees/feat/okta-sso` sur une nouvelle branche basée sur `HEAD`, puis bascule le répertoire de travail de la session à l'intérieur. Toutes les modifications de fichiers et commandes shell ultérieures opèrent à l'intérieur de ce worktree jusqu'à ce que vous en sortiez.

### Exemple 2 : rentrer dans un worktree existant

```
EnterWorktree(path="/Users/me/repo/.claude/worktrees/feat/okta-sso")
```

Reprend le travail dans un worktree précédemment créé. Comme vous y êtes entré via `path`, `ExitWorktree` ne le supprimera pas automatiquement — sortir avec `action: "keep"` retourne simplement au répertoire d'origine.

## Notes

- N'appelez pas `EnterWorktree` sauf si l'utilisateur l'a explicitement demandé ou si les instructions du projet l'exigent. Les changements de branche ordinaires ou les demandes de correction de bug doivent utiliser les commandes Git habituelles, pas les worktrees.
- Lorsqu'il est invoqué dans un dépôt Git, l'outil crée un worktree sous `.claude/worktrees/` et enregistre une nouvelle branche basée sur `HEAD`. En dehors d'un dépôt Git, il délègue aux hooks `WorktreeCreate` / `WorktreeRemove` configurés dans `settings.json` pour une isolation indépendante du VCS.
- Une seule session de worktree est active à la fois. L'outil refuse de s'exécuter si vous êtes déjà dans une session de worktree ; sortez d'abord avec `ExitWorktree`.
- Utilisez `ExitWorktree` pour sortir en cours de session. Si la session se termine alors que vous êtes encore dans un worktree nouvellement créé, l'utilisateur est invité à le conserver ou à le supprimer.
- Les worktrees entrés via `path` sont considérés comme externes — `ExitWorktree` avec `action: "remove"` ne les supprimera pas. C'est un garde-fou pour protéger les worktrees gérés manuellement par l'utilisateur.
- Un nouveau worktree hérite du contenu de la branche courante mais possède un répertoire de travail et un index indépendants. Les modifications stagées ou non stagées du checkout principal ne sont pas visibles dans le worktree.
- Astuce de nommage : préfixez avec le type de travail (`feat/`, `fix/`, `spike/`) afin que plusieurs worktrees concurrents soient faciles à distinguer dans `git worktree list`.
