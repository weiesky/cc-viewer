# TaskStop

Arrête une tâche d'arrière-plan en cours — une commande shell, un agent dispatché ou une session distante — par son handle d'exécution. Utilisez-le pour récupérer des ressources, annuler un travail qui n'est plus utile, ou récupérer quand une tâche est bloquée.

## Quand l'utiliser

- Une commande shell en arrière-plan tourne depuis plus longtemps que prévu et vous n'avez plus besoin de son résultat.
- Un agent local boucle ou est bloqué et doit être coupé court.
- L'utilisateur a changé de direction et le travail d'arrière-plan pour la direction précédente doit être abandonné.
- Une session distante est sur le point d'expirer ou détient une ressource dont vous avez besoin.
- Vous avez besoin d'une ardoise vierge avant de démarrer une nouvelle exécution de la même tâche.

Préférez laisser le travail d'arrière-plan de courte durée se terminer de lui-même. `TaskStop` est réservé aux cas où la poursuite de l'exécution n'a plus de valeur ou est activement nuisible.

## Paramètres

- `task_id` (string, requis) : le handle d'exécution renvoyé au démarrage de la tâche d'arrière-plan. C'est le même identifiant accepté par `TaskOutput`, pas un `taskId` de liste de tâches.

## Exemples

### Exemple 1

Arrêter une commande shell d'arrière-plan qui s'emballe.

```
TaskStop(task_id: "bash_01HXYZ...")
```

La commande reçoit un signal de terminaison ; la sortie mise en mémoire tampon écrite jusque-là reste lisible à son chemin de sortie.

### Exemple 2

Annuler un agent dispatché après une correction de trajectoire de l'utilisateur.

```
TaskStop(task_id: "agent_01ABCD...")
```

## Notes

- `TaskStop` demande la terminaison ; il ne garantit pas un arrêt instantané. Les tâches bien conçues sortent rapidement, mais un processus effectuant des E/S bloquantes peut prendre un moment pour se dérouler.
- Arrêter une tâche ne supprime pas sa sortie. Pour les tâches shell en arrière-plan, le fichier de sortie sur disque est préservé et reste lisible avec `Read`. Pour les agents et sessions, toute sortie capturée avant l'arrêt reste accessible via `TaskOutput`.
- Un `task_id` inconnu, ou une tâche déjà terminée, renvoie une erreur ou un no-op. C'est sûr — vous pouvez appeler `TaskStop` de manière défensive sans vérifier le statut au préalable.
- Si vous comptez relancer le même travail, arrêtez l'ancienne tâche avant de dispatcher la nouvelle pour éviter que deux exécutions parallèles ne se disputent des ressources partagées (fichiers, ports, lignes de base de données).
- `TaskStop` n'affecte pas les entrées de la liste de tâches d'équipe. Pour annuler une tâche suivie, mettez à jour son statut à `deleted` avec `TaskUpdate`.
