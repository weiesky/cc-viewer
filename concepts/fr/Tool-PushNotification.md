# PushNotification

Envoie une notification de bureau depuis la session Claude Code en cours. Si Remote Control est connecté, la notification est également transmise sur le téléphone de l'utilisateur, attirant son attention de là où il se trouve vers la session.

## Quand l'utiliser

- Une tâche longue s'est terminée alors que l'utilisateur était probablement absent du terminal
- Une compilation, une exécution de tests ou un déploiement est terminé et le résultat est prêt à être examiné
- Un point de décision nécessitant la saisie de l'utilisateur a été atteint avant de pouvoir continuer
- Une erreur ou un blocage est survenu et ne peut être résolu de façon autonome
- L'utilisateur a explicitement demandé à être notifié lorsqu'une tâche ou une condition spécifique est remplie

## Quand ne pas l'utiliser

N'envoyez pas de notification pour des mises à jour de progression routinières en cours de tâche, ni pour confirmer que vous avez répondu à quelque chose que l'utilisateur vient clairement de demander et attend. Ne notifiez pas lorsqu'une tâche courte se termine — si l'utilisateur vient de la soumettre et attend, la notification n'apporte aucune valeur et érode la confiance dans les notifications futures. Penchez fortement vers l'absence d'envoi.

## Activation

- Désactivé par défaut (drapeau de fonctionnalité côté serveur).
- La livraison passe par l'infrastructure hébergée par Anthropic — non disponible sur Amazon Bedrock, Claude Platform on AWS, Google Cloud ou Microsoft Foundry.
- Le push téléphone nécessite en plus un client Remote Control connecté.

## Paramètres

- `message` (chaîne, obligatoire) : le corps de la notification. Gardez-le sous 200 caractères ; les systèmes d'exploitation mobiles tronquent les chaînes plus longues. Commencez par ce sur quoi l'utilisateur agirait : "build failed: 2 auth tests" est plus utile que "task complete".
- `status` (chaîne, obligatoire) : toujours défini sur `"proactive"`. C'est un marqueur fixe qui ne change pas.

## Exemples

### Exemple 1 : notification à la fin d'une longue analyse

Un audit de dépendances sur l'ensemble du dépôt a été demandé et a pris plusieurs minutes. L'utilisateur s'est éloigné. Lorsque le rapport est prêt :

```
message: "Audit des dépendances terminé : 3 CVE critiques dans lodash, axios, jsonwebtoken. Rapport : audit-report.txt"
status: "proactive"
```

### Exemple 2 : signaler un point de décision lors d'un travail autonome

Au cours d'une refactorisation en plusieurs étapes, il s'avère que deux modules ont des interfaces en conflit et ne peuvent être fusionnés sans une décision de conception :

```
message: "Refactorisation suspendue : AuthService et UserService ont des interfaces de token incompatibles. Votre décision est nécessaire."
status: "proactive"
```

## Notes

- Penchez vers **ne pas** envoyer. La notification interrompt l'utilisateur quoi qu'il fasse. Traitez-la comme un coût qui doit être justifié par la valeur de l'information.
- Commencez par un contenu actionnable. Les premiers mots doivent indiquer ce qui s'est passé et ce que l'utilisateur doit faire, le cas échéant — pas une étiquette de statut générique.
- Gardez `message` sous 200 caractères. Les systèmes d'exploitation mobiles tronqueront les chaînes plus longues, coupant la partie la plus importante si elle apparaît à la fin.
- Si le résultat indique que le push n'a pas été envoyé parce que Remote Control n'est pas connecté, c'est le comportement attendu. Aucune nouvelle tentative ni action supplémentaire n'est nécessaire ; la notification de bureau locale se déclenche tout de même.
- Évitez le spam de notifications. Si vous envoyez des notifications fréquemment pour des événements mineurs, l'utilisateur commencera à les ignorer. Réservez cet outil aux moments où il y a une réelle probabilité que l'utilisateur soit absent et veuille connaître le résultat maintenant.
