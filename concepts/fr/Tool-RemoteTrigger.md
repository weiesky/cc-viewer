# RemoteTrigger

Appelle l'API de déclencheurs distants de claude.ai pour gérer l'exécution de tâches planifiées et à la demande. Le jeton OAuth est géré en interne par l'outil et n'est jamais exposé au modèle ni au shell.

## Quand l'utiliser

- Gérer des agents distants (déclencheurs) sur claude.ai, notamment lister, inspecter et mettre à jour les déclencheurs existants
- Créer une nouvelle tâche automatisée basée sur cron qui exécute un agent Claude selon un calendrier récurrent
- Déclencher un déclencheur existant à la demande sans attendre sa prochaine exécution planifiée
- Lister ou auditer tous les déclencheurs actuels pour examiner leur configuration et leur état
- Mettre à jour les paramètres d'un déclencheur, tels que le calendrier, la charge utile ou la description, sans avoir à le recréer

## Activation

- Nécessite un forfait claude.ai Pro, Max, Team ou Enterprise.
- Non disponible sur Amazon Bedrock, Claude Platform on AWS, Google Cloud ou Microsoft Foundry.
- Nécessite des drapeaux de fonctionnalité côté serveur et les paramètres de politique `allow_remote_sessions` / `allow_routines`.
- Pas pour les sessions distantes elles-mêmes.

## Paramètres

- `action` (string, requis) : l'opération à effectuer — l'une des valeurs `list`, `get`, `create`, `update` ou `run`
- `trigger_id` (string, requis pour `get`, `update` et `run`) : l'identifiant du déclencheur sur lequel opérer ; doit correspondre au modèle `^[\w-]+$` (caractères de mot et tirets uniquement)
- `body` (object, requis pour `create` et `update` ; optionnel pour `run`) : la charge utile de la requête envoyée à l'API

## Exemples

### Exemple 1 : lister tous les déclencheurs

```json
{
  "action": "list"
}
```

Appelle `GET /v1/code/triggers` et renvoie un tableau JSON de tous les déclencheurs associés au compte authentifié.

### Exemple 2 : créer un nouveau déclencheur qui s'exécute chaque matin en semaine

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "Générer un résumé quotidien chaque jour de semaine à 08h00 UTC"
  }
}
```

Appelle `POST /v1/code/triggers` avec le corps fourni et renvoie l'objet déclencheur nouvellement créé, incluant son `trigger_id` attribué.

### Exemple 3 : déclencher un déclencheur à la demande

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

Appelle immédiatement `POST /v1/code/triggers/my-report-trigger/run`, en contournant l'heure planifiée.

### Exemple 4 : récupérer un seul déclencheur

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

Appelle `GET /v1/code/triggers/my-report-trigger` et renvoie la configuration complète du déclencheur.

## Notes

- Le jeton OAuth est injecté en cours de processus par l'outil — ne copiez, ne collez ni n'enregistrez jamais les jetons manuellement ; cela crée un risque de sécurité et est inutile lors de l'utilisation de cet outil.
- Préférez cet outil à `curl` brut ou à d'autres clients HTTP pour tous les appels à l'API de déclencheurs ; l'utilisation directe de HTTP contourne l'injection sécurisée du jeton et peut exposer des informations d'identification.
- L'outil renvoie la réponse JSON brute de l'API ; l'appelant est responsable de l'analyse de la réponse et de la gestion des codes d'état d'erreur.
- La valeur de `trigger_id` doit correspondre au modèle `^[\w-]+$` — seuls les caractères alphanumériques, les traits de soulignement et les tirets sont autorisés ; les espaces ou les caractères spéciaux feront échouer la requête.
