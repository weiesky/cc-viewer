# CronList

Liste toutes les taches cron planifiees via `CronCreate` au cours de la session en cours. Retourne un resume de chaque cron actif comprenant son `id`, l'expression cron, le `prompt` abrege, l'indicateur `recurring`, l'indicateur `durable` et la prochaine heure d'execution.

## Quand l'utiliser

- Pour auditer l'ensemble des taches actuellement planifiees avant d'effectuer des modifications ou de terminer une session.
- Pour trouver le bon `id` d'une tache avant d'appeler `CronDelete` afin de la supprimer.
- Pour deboguer pourquoi une tache attendue ne s'est jamais declenchee, en confirmant son existence et en verifiant sa prochaine heure d'execution.
- Pour confirmer qu'une tache a execution unique (non recurrente) n'a pas encore ete declenchee et reste en attente.

## Parametres

Aucun.

## Exemples

### Exemple 1 : auditer toutes les taches planifiees

Appeler `CronList` sans argument pour recuperer la liste complete de toutes les taches cron actives. La reponse comprend pour chaque tache son `id`, l'expression cron definissant son calendrier, une version tronquee du `prompt` qu'elle executera, si elle est `recurring` (recurrente), si elle est `durable` (persistante apres redemarrage) et la prochaine heure d'execution prevue.

### Exemple 2 : localiser l'id d'une tache recurrente specifique

Si plusieurs taches cron ont ete creees et qu'il faut en supprimer une en particulier, appeler d'abord `CronList`. Parcourir la liste retournee pour trouver la tache dont le resume du `prompt` et l'expression cron correspondent a la tache ciblee. Copier son `id` et le passer a `CronDelete`.

## Notes

- Seules les taches creees lors de la session en cours sont listees, sauf si elles ont ete creees avec `durable: true`, ce qui leur permet de persister apres un redemarrage de session.
- Le champ `prompt` dans le resume est tronque ; il n'affiche que le debut du texte complet du prompt, pas son integralite.
- Les taches a execution unique (dont `recurring` est `false`) qui se sont deja declenchees sont automatiquement supprimees et n'apparaissent plus dans la liste.
