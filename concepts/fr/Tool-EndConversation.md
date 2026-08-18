# EndConversation

Met fin à la conversation courante et empêche l'envoi de tout message supplémentaire.

## Quand l'utiliser

- Uniquement en cas d'abus soutenu de la part de l'utilisateur, ou lorsque l'utilisateur demande explicitement une démonstration de cet outil.

C'est une action de dernier recours : les propres règles de l'outil exigent d'avertir d'abord l'utilisateur et de confirmer avant l'utilisation, et il ne doit jamais être utilisé dans des situations d'automutilation ou liées à un préjudice.

## Paramètres

Cet outil ne prend aucun paramètre.

## Exemples

### Exemple 1 : mettre fin à la conversation

```
EndConversation()
```

Le flux se fait en deux étapes : le premier appel renvoie un message de réflexion ; un second appel immédiatement après met réellement fin à la conversation (`ended: true`).

## Notes

- Fortement contrôlé : nécessite un modèle pris en charge, le point d'entrée CLI et un drapeau de fonctionnalité côté serveur — la plupart des sessions ne proposent pas cet outil.
- Une fois terminée, aucun autre message ne peut être envoyé dans la conversation.
