# CronDelete

Annule un job cron précédemment planifié avec `CronCreate`. Le supprime immédiatement du stockage de session en mémoire. N'a aucun effet si le job a déjà été supprimé automatiquement (les jobs à exécution unique sont supprimés après déclenchement, les jobs récurrents expirent après 7 jours).

## Quand l'utiliser

- Un utilisateur demande d'arrêter une tâche planifiée récurrente avant son expiration automatique de 7 jours.
- Un job à exécution unique n'est plus nécessaire et doit être annulé avant de se déclencher.
- L'expression de planification d'un job existant doit être modifiée — le supprimer avec `CronDelete`, puis le recréer avec `CronCreate` en utilisant la nouvelle expression.
- Nettoyer plusieurs jobs obsolètes pour garder le stockage de session en ordre.

## Paramètres

- `id` (string, requis) : L'identifiant de job retourné par `CronCreate` lors de la création initiale du job. Cette valeur doit correspondre exactement ; la recherche approximative ou par nom n'est pas prise en charge.

## Exemples

### Exemple 1 : annuler un job récurrent en cours d'exécution

Un job récurrent a été créé précédemment avec l'identifiant `"cron_abc123"`. L'utilisateur demande de l'arrêter.

```
CronDelete({ id: "cron_abc123" })
```

Le job est supprimé du stockage de session et ne se déclenchera plus.

### Exemple 2 : supprimer un job à exécution unique obsolète avant son déclenchement

Un job à exécution unique avec l'identifiant `"cron_xyz789"` a été planifié pour s'exécuter dans 30 minutes, mais l'utilisateur a décidé qu'il n'est plus nécessaire.

```
CronDelete({ id: "cron_xyz789" })
```

Le job est annulé. Aucune action ne sera effectuée lorsque l'heure de déclenchement originale sera atteinte.

## Notes

- L'`id` doit être obtenu à partir de la valeur de retour de `CronCreate`. Il n'existe aucun moyen de rechercher un job par description ou par callback — conservez l'identifiant si vous pourriez avoir besoin de l'annuler ultérieurement.
- Si le job a déjà été supprimé automatiquement (déclenché en tant que job à exécution unique, ou ayant atteint l'expiration récurrente de 7 jours), appeler `CronDelete` avec cet identifiant est une opération sans effet et ne produira pas d'erreur.
- `CronDelete` n'affecte que la session en mémoire actuelle. Si l'environnement d'exécution ne persiste pas l'état cron entre les redémarrages, les jobs planifiés seront perdus au redémarrage, que `CronDelete` ait été appelé ou non.
- Il n'existe pas d'opération de suppression en masse ; annulez chaque job individuellement en utilisant son propre `id`.
