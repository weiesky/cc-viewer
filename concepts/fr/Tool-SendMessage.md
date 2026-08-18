# SendMessage

Transmet un message d'un membre d'équipe à un autre au sein d'une équipe active, ou diffuse à tous les coéquipiers en même temps. C'est le seul canal que les coéquipiers peuvent entendre — tout ce qui est écrit en sortie texte normale leur est invisible.

## Quand l'utiliser

- Attribuer une tâche ou transférer un sous-problème à un coéquipier nommé pendant une collaboration d'équipe.
- Demander un statut, des résultats intermédiaires ou une revue de code à un autre agent.
- Diffuser une décision, une contrainte partagée ou une annonce d'arrêt à toute l'équipe via `*`.
- Répondre à une invite de protocole telle qu'une demande d'arrêt ou une demande d'approbation de plan du chef d'équipe.
- Boucler la boucle à la fin d'une tâche déléguée afin que le chef puisse marquer l'élément terminé.

## Activation

- Contrôlé par les mêmes conditions de messagerie inter-sessions que `ListAgents` (drapeaux de fonctionnalité côté serveur, désactivés par défaut).
- Les coéquipiers nécessitent en plus l'activation des équipes d'agents expérimentales.

## Paramètres

- `to` (string, requis) : le `name` du coéquipier cible tel qu'enregistré dans l'équipe, ou `*` pour diffuser à tous les coéquipiers à la fois.
- `message` (string ou object, requis) : texte brut pour une communication normale, ou objet structuré pour les réponses de protocole telles que `shutdown_response` et `plan_approval_response`.
- `summary` (string, optionnel) : aperçu de 5 à 10 mots affiché dans le journal d'activité de l'équipe pour les messages texte. Requis pour les longs messages de type chaîne ; ignoré lorsque `message` est un objet de protocole.

## Exemples

### Exemple 1 : transfert direct de tâche

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### Exemple 2 : diffuser une contrainte partagée

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### Exemple 3 : réponse de protocole

Répondez à une demande d'arrêt du chef via un message structuré :

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### Exemple 4 : réponse d'approbation de plan

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## Notes

- Votre sortie texte d'assistant habituelle n'est PAS transmise aux coéquipiers. Si vous voulez qu'un autre agent voie quelque chose, cela doit passer par `SendMessage`. C'est l'erreur la plus courante dans les workflows d'équipe.
- La diffusion (`to: "*"`) est coûteuse — elle réveille chaque coéquipier et consomme son contexte. Réservez-la aux annonces qui concernent réellement tout le monde. Préférez les envois ciblés.
- Gardez les messages concis et orientés action. Incluez les chemins de fichiers, les contraintes et le format de réponse attendu dont le destinataire a besoin ; rappelez-vous qu'il n'a pas de mémoire partagée avec vous.
- Les objets de message de protocole (`shutdown_response`, `plan_approval_response`) ont des formes fixes. Ne mélangez pas les champs de protocole dans les messages texte ou vice versa.
- Les messages sont asynchrones. Le destinataire recevra le vôtre à son prochain tour ; ne supposez pas qu'il l'a lu ou a agi dessus avant qu'il ne réponde.
- Un `summary` bien rédigé rend le journal d'activité de l'équipe scannable pour le chef — traitez-le comme une ligne d'objet de commit.
