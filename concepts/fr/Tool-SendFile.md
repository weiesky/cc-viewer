# SendFile

Envoie un ou plusieurs fichiers à une autre session Claude Code — un pair listé par `ListAgents`, ou une adresse de session explicite.

## Quand l'utiliser

- Une session pair a besoin d'un fichier de votre répertoire de travail (un rapport, un patch, une fixture) pour poursuivre sa propre tâche.
- Vous coordonnez un travail entre sessions et voulez transmettre des artefacts, pas seulement du texte (utilisez `SendMessage` pour le texte).

## Paramètres

- `to` (string, requis) : destinataire — un nom de session pair provenant de `ListAgents`, ou une adresse explicite `uds:<socket>` / `bridge:<session id>`.
- `files` (array de strings, requis) : chemins de fichiers (absolus ou relatifs au cwd) à envoyer. Passez toujours un array, même pour un seul fichier. 1 à 16 fichiers, 30 Mio maximum chacun.
- `message` (string, optionnel) : message court livré avec les fichiers.

## Exemples

### Exemple 1 : envoyer un rapport à une session pair

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## Notes

- Le transfert de fichiers inter-sessions doit être disponible dans la session ; lorsqu'il ne l'est pas, la validation échoue avec "Cross-session file transfer is not available in this session."
- Les transferts vers des machines distantes peuvent nécessiter une approbation supplémentaire.
- La lecture du contenu du fichier fait partie de l'envoi — refusée si les lectures de fichiers sont désactivées par des règles de permission.
