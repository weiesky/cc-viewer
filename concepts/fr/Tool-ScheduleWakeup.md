# ScheduleWakeup

Planifie le moment où reprendre le travail en mode dynamique `/loop`. L'outil permet à Claude de gérer lui-même le rythme des itérations d'une tâche en dormant pendant l'intervalle choisi, puis en se déclenchant à nouveau avec le même prompt de boucle.

## Quand l'utiliser

- Pour gérer le rythme d'une tâche dynamique `/loop` où l'intervalle d'itération dépend de l'état du travail plutôt que d'une horloge fixe
- Pour attendre la fin d'une longue compilation, d'un déploiement ou d'une exécution de tests avant de vérifier les résultats
- Pour insérer des ticks d'inactivité entre les itérations quand il n'y a aucun signal spécifique à surveiller pour le moment
- Pour exécuter une boucle autonome sans prompt utilisateur — passer le sentinel littéral `<<autonomous-loop-dynamic>>` comme `prompt`
- Pour interroger un processus dont l'état est sur le point de changer (utiliser un délai court pour maintenir le cache chaud)

## Activation

- Non disponible sur Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform ou Microsoft Foundry.
- Également désactivé lorsque la récupération des drapeaux de fonctionnalité est désactivée (variables d'environnement de télémétrie/trafic).

## Paramètres

- `delaySeconds` (nombre, requis) : Secondes avant la reprise. Le runtime limite automatiquement la valeur à `[60, 3600]`, il n'est donc pas nécessaire de la limiter manuellement.
- `reason` (chaîne, requis) : Une courte phrase expliquant le délai choisi. Affichée à l'utilisateur et enregistrée dans la télémétrie. Soyez précis — « vérification de la longue compilation bun » est plus utile que « en attente ».
- `prompt` (chaîne, requis) : L'entrée `/loop` à déclencher au réveil. Passer la même chaîne à chaque tour pour que le prochain déclenchement répète la tâche. Pour une boucle autonome sans prompt utilisateur, passer le sentinel littéral `<<autonomous-loop-dynamic>>`.

## Exemples

### Exemple 1 : court délai pour revérifier un signal qui change rapidement (maintenir le cache chaud)

Une compilation vient d'être lancée et se termine généralement en deux à trois minutes.

```json
{
  "delaySeconds": 120,
  "reason": "vérification de la compilation bun attendue dans ~2 min",
  "prompt": "vérifier l'état de la compilation et signaler les erreurs"
}
```

120 secondes maintient le contexte de la conversation dans le cache de prompts Anthropic (TTL 5 min), ce qui rend le prochain réveil plus rapide et moins coûteux.

### Exemple 2 : long tick d'inactivité (accepter un échec de cache, amortir sur une attente plus longue)

Une migration de base de données est en cours et prend généralement 20 à 40 minutes.

```json
{
  "delaySeconds": 1200,
  "reason": "la migration prend généralement 20–40 min ; vérification dans 20 min",
  "prompt": "vérifier l'état de la migration et continuer si terminée"
}
```

Le cache sera froid au réveil, mais l'attente de 20 minutes amortit largement le coût du seul échec de cache. Interroger toutes les 5 minutes paierait le même coût d'échec 4 fois pour aucun bénéfice.

## Notes

- **TTL de cache de 5 minutes** : Le cache de prompts Anthropic expire après 300 secondes. Les délais inférieurs à 300 s maintiennent le contexte chaud ; les délais supérieurs à 300 s entraînent un échec de cache au prochain réveil.
- **Éviter exactement 300 s** : C'est le pire des deux mondes — on paie l'échec de cache sans obtenir une attente significativement plus longue. Soit réduire à 270 s (maintenir le cache chaud), soit s'engager à 1200 s ou plus (un seul échec achète une attente bien plus longue).
- **Valeur par défaut pour les ticks d'inactivité** : Quand il n'y a aucun signal spécifique à surveiller, utiliser **1200–1800 s** (20–30 min). Cela permet à la boucle de vérifier périodiquement sans brûler le cache 12 fois par heure pour rien.
- **Limitation automatique** : Le runtime limite `delaySeconds` à `[60, 3600]`. Les valeurs inférieures à 60 deviennent 60 ; les valeurs supérieures à 3600 deviennent 3600. Il n'est pas nécessaire de gérer ces limites soi-même.
- **Omettre l'appel pour terminer la boucle** : Si l'on souhaite arrêter les itérations, ne pas appeler ScheduleWakeup. Simplement omettre l'appel termine la boucle.
- **Passer le même `prompt` à chaque tour** : Le champ `prompt` doit contenir l'instruction `/loop` originale à chaque invocation pour que le prochain réveil sache quelle tâche reprendre.
