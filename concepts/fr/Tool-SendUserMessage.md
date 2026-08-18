# SendUserMessage

Envoie un message à l'utilisateur — le canal de sortie visible principal dans les sessions de style brief. Aussi connu sous son ancien alias `Brief`.

## Quand l'utiliser

- Répondre à quelque chose que l'utilisateur vient de dire (`status="normal"`).
- Mettre en avant de façon proactive quelque chose que l'utilisateur n'a pas demandé et qu'il doit voir maintenant — une tâche qui se termine pendant son absence, un blocage que vous avez rencontré, une mise à jour de statut non sollicitée (`status="proactive"`).

## Activation

- Masqué par défaut dans les sessions interactives ; la plupart des sessions CLI interactives s'adressent directement à l'utilisateur à la place.
- Activé en mode brief ou via des drapeaux de fonctionnalité côté serveur.

## Paramètres

En mode brief :

- `message` (string, requis) : le message pour l'utilisateur. Prend en charge le formatage markdown.
- `attachments` (array, optionnel) : pièces jointes affichées à côté du message. Chaque entrée est soit un chemin de fichier (absolu ou relatif au cwd) pour un fichier lisible localement, soit un objet `{file_uuid, file_name, size, is_image}` pré-résolu obtenu d'un outil de périphérique tel que `attach_file`.
- `status` (string, requis) : `proactive` pour les mises à jour non sollicitées dont l'utilisateur a besoin maintenant ; `normal` lorsque vous répondez à l'utilisateur.

Dans les builds non brief, seul `message` est disponible.

## Exemples

### Exemple 1 : avis d'achèvement proactif

```
SendUserMessage(
  message="The migration finished — 42 files updated, tests green.",
  status="proactive"
)
```

## Notes

- Utilisez `proactive` avec parcimonie — il est destiné aux choses qui nécessitent réellement l'attention de l'utilisateur maintenant.
