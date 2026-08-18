# Artifact

Rendre un fichier HTML ou Markdown dans un Artifact — une page web hébergée sur claude.ai qui est privée par défaut et que l'utilisateur peut ouvrir dans un navigateur et choisir de partager ultérieurement. Utilisez-le quand la communication visuelle est supérieure au texte du terminal.

## Quand l'utiliser

- Publier un livrable visuel : un rapport, un tableau de bord, une enquête de bug ou une maquette d'interface
- Mettre à jour une page précédemment publiée en place (même chemin de fichier → même URL au redéploiement)
- Lister les artifacts existants de l'utilisateur pour en trouver un d'une session antérieure (`action: "list"`)
- **Pas** pour du contenu qui doit rester local, des réponses en texte brut ou quoi que ce soit nécessitant des ressources réseau externes au moment de la visualisation — une CSP stricte bloque chaque hôte externe

## Activation

- Nécessite un forfait Pro, Max, Team ou Enterprise avec connexion claude.ai (`/login`).
- API Anthropic uniquement — non disponible sur Amazon Bedrock, Google Cloud ou Microsoft Foundry.
- Nécessite Claude Code ≥ 2.1.183 ou l'application Desktop ≥ 1.13576.0.
- Désactiver avec le paramètre `disableArtifact` ou `CLAUDE_CODE_DISABLE_ARTIFACT=1`.

## Paramètres

- `file_path` (chaîne) : Chemin vers le fichier `.html` ou `.md` à rendre. Le fichier est enrobé dans un squelette de document au moment de la publication, donc écrivez le contenu de la page directement — pas de balises `<!DOCTYPE>`, `<html>`, `<head>` ou `<body>`. Même chemin → même URL au redéploiement ; un chemin différent réclame une nouvelle URL.
- `favicon` (chaîne, requise pour publier) : Un ou deux emoji utilisés comme icône d'onglet du navigateur (p. ex. `"📊"`). Emoji uniquement, pas de balisage. Conservez-le identique lors des redéploiements — les utilisateurs trouvent leur onglet par l'icône.
- `description` (chaîne) : Un sous-titre d'une phrase affiché sur la carte de galerie d'artifacts.
- `url` (chaîne, optionnel) : Passez l'URL d'un artifact existant pour le mettre à jour à partir d'une conversation qui ne l'a pas publié. Sans cela, une nouvelle conversation crée toujours une nouvelle URL.
- `label` (chaîne, optionnel) : Nom de version court et lisible (max 60 caractères) affiché dans le sélecteur de version.
- `action` (chaîne, optionnel) : `"publish"` (défaut) ou `"list"` — énumère les artifacts publiés de l'utilisateur (titre, URL, dernière mise à jour), optionnellement avec `limit`.
- `force` (booléen, optionnel) : Remplacer sans vérification de conflit. Seulement après un 409 d'écriture concurrente, une fois concilié.

## Notes

- **Autonome uniquement.** Une CSP stricte bloque les demandes à chaque hôte externe — scripts CDN, feuilles de style externes, images distantes, fetch/WebSockets. Incorporez tout le CSS/JS et intégrez les ressources en tant qu'URIs `data:`.
- **Réactif et conscient du thème.** Les pages sont rendues dans le thème clair ou sombre de l'utilisateur ; stylez les deux (`prefers-color-scheme` plus l'override `data-theme` de l'utilisateur). Le contenu large défile dans son propre conteneur — le corps de la page ne doit jamais défiler horizontalement.
- **Mettre à jour entre les conversations nécessite `url`.** Redéployer le même chemin réutilise seulement l'URL dans la conversation qui l'a publié ; pour conserver le lien d'un artifact ancien, trouvez son URL avec `action: "list"` et passez-la en tant que `url`.
- **Publier est public.** Le contenu envoyé au service d'artifacts peut être mis en cache même s'il est supprimé ultérieurement — ne publiez rien qui doit rester privé sur la machine.
- **Relire avec WebFetch.** Les URLs d'artifacts de claude.ai peuvent être récupérées via WebFetch (pas curl, qui obtient le shell de l'application).
