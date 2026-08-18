# SendUserFile

Envoie un ou plusieurs fichiers à l'utilisateur — artefacts générés, captures d'écran, rapports — avec un contrôle sur la façon dont le client les présente.

## Quand l'utiliser

- Vous avez produit un fichier dont l'utilisateur a besoin (un rapport, une image, une page HTML) et vous voulez le mettre en avant, pas seulement mentionner son chemin.
- Répondre avec une pièce jointe (`status="normal"`), ou mettre en avant de façon proactive quelque chose que l'utilisateur n'a pas demandé mais qu'il doit voir maintenant (`status="proactive"`).

## Activation

- Disponible uniquement lorsqu'un client Remote Control est connecté, ou lorsque la session s'exécute dans un environnement cloud géré (p. ex. Claude Code sur le web).
- Non disponible sur Amazon Bedrock, Google Cloud ou Microsoft Foundry.
- Nécessite que la session autorise l'envoi de fichiers (capacité contrôlée par des paramètres/un drapeau de fonctionnalité) ; non proposé en mode brief.

## Paramètres

- `files` (array de strings, requis) : chemins de fichiers (absolus ou relatifs au cwd) à envoyer à l'utilisateur. Passez toujours un array, même pour un seul fichier.
- `caption` (string, optionnel) : légende courte pour le ou les fichiers.
- `status` (string, requis) : `proactive` lorsque vous mettez en avant un fichier que l'utilisateur n'a pas demandé et qu'il doit voir maintenant — un artefact généré, un rapport terminé ; `normal` lorsque vous répondez à quelque chose que l'utilisateur vient de dire.
- `display` (string, optionnel) : `render` ouvre le fichier en ligne dans le panneau latéral (HTML, SVG, Mermaid, images, PDF) ; `attach` n'affiche qu'une carte de téléchargement (livrables que l'utilisateur enregistrera et ouvrira ailleurs). Omettez pour laisser le client décider selon le type de fichier.

## Exemples

### Exemple 1 : livrer un rapport généré

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Notes

- Choisissez `display="attach"` pour les fichiers que l'utilisateur enregistre et ouvre dans une autre application ; `render` pour tout ce qu'il doit regarder immédiatement.
