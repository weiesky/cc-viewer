# TaskOutput

Récupère la sortie accumulée d'une tâche d'arrière-plan en cours ou terminée — une commande shell en arrière-plan, un agent local ou une session distante. Utilisez-le lorsque vous devez inspecter ce qu'une tâche de longue durée a produit jusqu'à présent.

## Quand l'utiliser

- Une session distante (par exemple un sandbox cloud) est en cours d'exécution et vous avez besoin de sa sortie standard.
- Un agent local a été dispatché en arrière-plan et vous souhaitez une progression partielle avant qu'il ne renvoie son résultat.
- Une commande shell en arrière-plan est en cours depuis assez longtemps pour que vous souhaitiez vérifier sans l'arrêter.
- Vous devez confirmer qu'une tâche d'arrière-plan progresse réellement avant d'attendre plus longtemps ou d'appeler `TaskStop`.

Ne recourez pas à `TaskOutput` par réflexe. Pour la plupart des travaux d'arrière-plan, il existe un chemin plus direct — voir les notes ci-dessous.

## Paramètres

- `task_id` (string, requis) : l'identifiant de tâche renvoyé au démarrage du travail en arrière-plan. Ce n'est pas la même chose qu'un `taskId` de liste de tâches ; c'est le handle d'exécution de l'exécution spécifique.
- `block` (boolean, optionnel) : lorsque `true` (par défaut), attendez que la tâche produise une nouvelle sortie ou se termine avant de renvoyer. Lorsque `false`, renvoyez immédiatement ce qui est mis en mémoire tampon.
- `timeout` (number, optionnel) : millisecondes maximales de blocage avant de renvoyer. N'a de sens que lorsque `block` est `true`. Défaut `30000`, maximum `600000`.

## Exemples

### Exemple 1

Jeter un coup d'œil à une session distante sans bloquer.

```
TaskOutput(task_id: "sess_01HXYZ...", block: false)
```

Renvoie tout ce qui a été produit en sortie standard / erreur depuis le démarrage de la tâche (ou depuis votre dernier appel `TaskOutput`, selon l'environnement d'exécution).

### Exemple 2

Attendre brièvement qu'un agent local émette plus de sortie.

```
TaskOutput(
  task_id: "agent_01ABCD...",
  block: true,
  timeout: 10000
)
```

## Notes

- Commandes bash en arrière-plan : `TaskOutput` est en pratique déprécié pour ce cas d'usage. Lorsque vous démarrez une tâche shell en arrière-plan, le résultat inclut déjà le chemin de son fichier de sortie — lisez ce chemin directement avec l'outil `Read`. `Read` vous donne un accès aléatoire, des offsets de ligne et une vue stable ; `TaskOutput` non.
- Agents locaux (l'outil `Agent` dispatché en arrière-plan) : lorsque l'agent termine, le résultat de l'outil `Agent` contient déjà sa réponse finale. Utilisez-la directement. Ne lisez pas le fichier de transcription symlinké — il contient le flux complet d'appels d'outils et débordera la fenêtre de contexte.
- Sessions distantes : `TaskOutput` est la méthode correcte et souvent la seule pour récupérer la sortie en streaming. Préférez `block: true` avec un `timeout` modeste plutôt que des boucles de polling serrées.
- Un `task_id` inconnu, ou une tâche dont la sortie a été collectée par le ramasse-miettes, renvoie une erreur. Relancez le travail si vous en avez encore besoin.
- `TaskOutput` n'arrête pas la tâche. Utilisez `TaskStop` pour terminer.
