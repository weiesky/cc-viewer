# ListAgents

Liste les agents auxquels vous pouvez envoyer un `SendMessage` : les sous-agents in-process que vous avez lancés, les autres sessions Claude locales sur cette machine, vos sessions cloud (lorsque cette session a un accès cloud) et — lorsque Remote Control est connecté — les autres sessions de votre compte. Chaque ligne est étiquetée par type.

## Quand l'utiliser

- Vous avez besoin du nom exact d'une session pair ou d'un sous-agent avant de lui envoyer un message.
- Vous voulez voir quelles sessions sont actuellement joignables depuis celle-ci.

## Activation

- Nécessite Claude Code 2.1.224+ et la messagerie inter-sessions (un drapeau de fonctionnalité côté serveur, désactivé par défaut).
- La messagerie inter-sessions n'est pas disponible sur Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform et Microsoft Foundry.
- Désactivé lorsque `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK` ou `DISABLE_GROWTHBOOK` est défini.
- Activer de force avec `CLAUDE_CODE_HARBOR_KITE=1`.

## Paramètres

- `channel` (string, optionnel) : non disponible dans cette version ; laissez non défini.
- `q` (string, optionnel) : non disponible dans cette version ; laissez non défini.

## Exemples

### Exemple 1 : lister les agents joignables

```
ListAgents()
```

Chaque ligne affiche un nom — ce nom est l'adresse. Envoyez avec `SendMessage({to: "<name>", message: "..."})`, en copiant le nom exactement tel qu'affiché. Ajoutez le ` [ref]` d'une ligne uniquement lorsque le nom nu est ambigu (deux lignes le partagent, ou une erreur vous demande de désambiguïser).

## Notes

- Lecture seule et sûr en concurrence.
- Une session cloud reçoit votre message mais ne peut pas encore répondre — lisez sa réponse dans sa propre transcription.
