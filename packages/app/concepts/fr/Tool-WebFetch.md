# WebFetch

Récupère le contenu d'une page web publique, convertit le HTML en Markdown et exécute un petit modèle auxiliaire sur le résultat à l'aide d'une invite en langage naturel pour extraire les informations dont vous avez besoin.

## Quand l'utiliser

- Lire une page de documentation publique, un article de blog ou une RFC référencé dans la conversation.
- Extraire un fait spécifique, un extrait de code ou un tableau d'une URL connue sans charger la page entière dans le contexte.
- Résumer des notes de version ou des changelogs d'une ressource web ouverte.
- Consulter la référence d'API publique d'une bibliothèque lorsque le code source n'est pas dans le dépôt local.
- Suivre un lien que l'utilisateur a collé dans le chat pour répondre à une question de suivi.

## Paramètres

- `url` (string, requis) : une URL absolue bien formée. Le simple `http://` est automatiquement mis à niveau en `https://`.
- `prompt` (string, requis) : l'instruction passée au petit modèle d'extraction. Décrivez exactement ce qu'il faut extraire de la page, par exemple « list all exported functions » ou « return the minimum supported Node version ».

## Exemples

### Exemple 1 : extraire une valeur de configuration par défaut

```
WebFetch(
  url="https://vitejs.dev/config/server-options.html",
  prompt="What is the default value of server.port and can it be a string?"
)
```

L'outil récupère la page de documentation Vite, la convertit en Markdown et renvoie une courte réponse telle que « Default is `5173`; accepts a number only. »

### Exemple 2 : résumer une section de changelog

```
WebFetch(
  url="https://nodejs.org/en/blog/release/v20.11.0",
  prompt="List the security fixes included in this release as bullet points."
)
```

Utile lorsque l'utilisateur demande « qu'est-ce qui a changé dans Node 20.11 » et que la page de version est longue.

## Notes

- `WebFetch` échoue sur toute URL nécessitant authentification, cookies ou VPN. Pour Google Docs, Confluence, Jira, les ressources GitHub privées ou les wikis internes, utilisez plutôt un serveur MCP dédié qui fournit un accès authentifié.
- Pour tout ce qui est hébergé sur GitHub (PR, issues, blobs de fichiers, réponses d'API), préférez la CLI `gh` via `Bash` plutôt que de scraper l'UI web. `gh pr view`, `gh issue view` et `gh api` renvoient des données structurées et fonctionnent sur des dépôts privés.
- Les résultats peuvent être résumés lorsque la page récupérée est très grande. Si vous avez besoin du texte exact, restreignez le `prompt` pour demander un extrait littéral.
- Un cache auto-nettoyant de 15 minutes est appliqué par URL. Les appels répétés à la même page pendant une session sont quasi instantanés mais peuvent renvoyer du contenu légèrement obsolète. Si la fraîcheur importe, mentionnez-le dans l'invite ou attendez que le cache expire.
- Si l'hôte cible émet une redirection cross-host, l'outil renvoie la nouvelle URL dans un bloc de réponse spécial et ne la suit pas automatiquement. Réinvoquez `WebFetch` avec la cible de redirection si vous voulez toujours le contenu.
- L'invite est exécutée par un modèle plus petit et plus rapide que l'assistant principal. Gardez-la étroite et concrète ; le raisonnement complexe en plusieurs étapes est mieux géré en lisant vous-même le Markdown brut après la récupération.
- Ne passez jamais de secrets, jetons ou identifiants de session intégrés dans l'URL — le contenu des pages et les chaînes de requête reflétés dans la sortie peuvent être enregistrés par les services en amont.
