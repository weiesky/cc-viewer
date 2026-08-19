# ExitWorktree

Quitte une session de worktree précédemment créée par `EnterWorktree` et ramène la session dans le répertoire de travail d'origine. Cet outil agit uniquement sur les worktrees créés par `EnterWorktree` dans la session en cours ; s'il n'y a aucune session active de ce type, l'appel est sans effet.

## Quand l'utiliser

- Le travail dans un worktree isolé est terminé et vous souhaitez revenir au répertoire de travail principal.
- Une tâche dans un worktree de branche de fonctionnalité est achevée et, après la fusion, vous voulez nettoyer la branche et le répertoire.
- Vous souhaitez conserver le worktree pour une utilisation ultérieure et simplement revenir au répertoire d'origine sans rien supprimer.
- Vous souhaitez abandonner une branche expérimentale ou temporaire sans laisser d'artefacts sur le disque.
- Vous devez démarrer une nouvelle session `EnterWorktree`, ce qui nécessite de quitter d'abord la session actuelle.

## Paramètres

- `action` (chaîne, obligatoire) : `"keep"` conserve le répertoire du worktree et la branche sur le disque afin de pouvoir y revenir plus tard ; `"remove"` supprime le répertoire et la branche, effectuant une sortie propre.
- `discard_changes` (booléen, optionnel, valeur par défaut `false`) : Pertinent uniquement lorsque `action` vaut `"remove"`. Si le worktree contient des fichiers non commités ou des commits absents de la branche d'origine, l'outil refuse la suppression à moins que `discard_changes` ne soit `true`. La réponse d'erreur liste les modifications concernées afin que vous puissiez confirmer avec l'utilisateur avant de relancer l'appel.

## Exemples

### Exemple 1 : sortie propre après la fusion des modifications

Après avoir terminé le travail dans un worktree et fusionné la branche dans main, appelez `ExitWorktree` avec `action: "remove"` pour supprimer le répertoire du worktree et la branche, et revenir au répertoire de travail d'origine.

```
ExitWorktree(action: "remove")
```

### Exemple 2 : suppression d'un worktree temporaire contenant du code expérimental non commité

Si un worktree contient des modifications expérimentales non commitées à supprimer entièrement, commencez par tenter `action: "remove"`. L'outil refusera et listera les modifications non commitées. Après confirmation de l'utilisateur que les modifications peuvent être supprimées, relancez l'appel avec `discard_changes: true`.

```
ExitWorktree(action: "remove", discard_changes: true)
```

## Notes

- Cet outil agit uniquement sur les worktrees créés par `EnterWorktree` dans la session en cours. Il n'affectera pas les worktrees créés avec `git worktree add`, les worktrees de sessions précédentes, ni le répertoire de travail ordinaire si `EnterWorktree` n'a jamais été appelé — dans ces cas, l'appel est sans effet.
- `action: "remove"` est refusé si le worktree contient des modifications non commitées ou des commits absents de la branche d'origine, à moins que `discard_changes: true` ne soit explicitement fourni. Confirmez toujours avec l'utilisateur avant de définir `discard_changes: true`, car les données ne peuvent pas être récupérées.
- Si une session tmux est attachée au worktree : avec `remove`, elle est terminée ; avec `keep`, elle continue de s'exécuter et son nom est retourné afin que l'utilisateur puisse se reconnecter ultérieurement.
- Après la fin de `ExitWorktree`, `EnterWorktree` peut être appelé à nouveau pour démarrer une nouvelle session de worktree.
