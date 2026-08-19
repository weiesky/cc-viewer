# CronCreate

Planifie un prompt pour qu'il soit mis en file d'attente à un moment futur, qu'il s'agisse d'une exécution unique ou récurrente. Utilise la syntaxe cron standard à 5 champs dans le fuseau horaire local de l'utilisateur, sans conversion de fuseau horaire.

## Quand l'utiliser

- **Rappels ponctuels** : Lorsqu'un utilisateur souhaite être rappelé à un moment précis ("rappelle-moi demain à 15h"). Avec `recurring: false`, la tâche se supprime automatiquement après exécution.
- **Planifications récurrentes** : Lorsqu'une action doit se répéter régulièrement ("chaque jour ouvrable à 9h", "toutes les 30 minutes"). La valeur par défaut `recurring: true` couvre ce cas.
- **Boucles d'agent autonome** : Pour construire des flux de travail qui se re-déclenchent selon un calendrier — par exemple un résumé quotidien ou une vérification d'état périodique.
- **Tâches persistantes** : Lorsque la planification doit survivre à un redémarrage de session. En passant `durable: true`, la tâche est écrite dans `.claude/scheduled_tasks.json`.
- **Demandes à heure approximative** : Lorsque l'utilisateur dit "vers 9h" ou "toutes les heures", choisissez une minute décalée (p. ex. `57 8 * * *` ou `7 * * * *`) pour éviter que tous les utilisateurs se regroupent à :00 ou :30.

## Paramètres

- `cron` (string, obligatoire) : Expression cron à 5 champs dans le fuseau horaire local de l'utilisateur. Format : `minute heure jour-du-mois mois jour-de-la-semaine`. Exemple : `"0 9 * * 1-5"` signifie du lundi au vendredi à 9h00.
- `prompt` (string, obligatoire) : Le texte du prompt à mettre en file d'attente lors du déclenchement du cron — le message exact qui sera soumis au REPL au moment planifié.
- `recurring` (boolean, optionnel, défaut `true`) : Avec `true`, le job s'exécute à chaque intervalle cron correspondant et expire automatiquement après 7 jours. Avec `false`, le job s'exécute exactement une fois puis est supprimé — pour les rappels ponctuels.
- `durable` (boolean, optionnel, défaut `false`) : Avec `false`, la planification n'existe qu'en mémoire et disparaît à la fin de la session. Avec `true`, la tâche est persistée dans `.claude/scheduled_tasks.json` et survit aux redémarrages.

## Exemples

### Exemple 1 : rappel ponctuel

L'utilisateur dit : "Rappelle-moi demain à 14h30 d'envoyer le rapport hebdomadaire." En supposant que demain est le 21 avril :

```json
{
  "cron": "30 14 21 4 *",
  "prompt": "Rappel : envoie le rapport hebdomadaire maintenant.",
  "recurring": false,
  "durable": true
}
```

`recurring: false` garantit que la tâche se supprime après déclenchement. `durable: true` la maintient à travers tout redémarrage préalable.

### Exemple 2 : tâche matinale récurrente en semaine

L'utilisateur dit : "Chaque matin de la semaine, résume mes issues GitHub ouvertes."

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "Résume toutes les issues GitHub ouvertes qui me sont assignées.",
  "recurring": true,
  "durable": true
}
```

La minute `3` au lieu de `0` évite le pic de charge à l'heure pile. Le job expire automatiquement après 7 jours.

## Notes

- **Expiration automatique à 7 jours** : Les jobs récurrents sont automatiquement supprimés après 7 jours au maximum. Pour une planification plus longue, recréez la tâche avant son expiration.
- **Déclenchement uniquement en mode inactif** : `CronCreate` met le prompt en file d'attente uniquement lorsque le REPL ne traite pas une autre requête. Si le REPL est occupé au moment du déclenchement, le prompt attend la fin de la requête en cours.
- **Éviter les minutes :00 et :30** : Pour les demandes à heure approximative, choisissez délibérément des valeurs de minute décalées pour répartir la charge système. Réservez :00/:30 uniquement lorsque l'utilisateur spécifie cette minute exacte.
- **Aucune conversion de fuseau horaire** : L'expression cron est interprétée directement dans le fuseau horaire local de l'utilisateur. Aucune conversion en UTC ou autre zone n'est nécessaire.
