# WebFetch

## Définition

Récupère le contenu d'une page web à partir d'une URL spécifiée, convertit le HTML en markdown et traite le contenu avec un modèle d'IA selon le prompt.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `url` | string (URI) | Oui | URL complète à récupérer |
| `prompt` | string | Oui | Décrit quelles informations extraire de la page |

## Cas d'utilisation

**Adapté pour :**
- Récupérer le contenu de pages web publiques
- Consulter la documentation en ligne
- Extraire des informations spécifiques de pages web

**Non adapté pour :**
- URLs nécessitant une authentification (Google Docs, Confluence, Jira, GitHub, etc.) — chercher d'abord des outils MCP dédiés
- URLs GitHub — préférer utiliser le CLI `gh`

## Notes

- L'URL doit être une URL valide complète
- HTTP est automatiquement mis à niveau vers HTTPS
- Les résultats peuvent être résumés si le contenu est trop volumineux
- Inclut un cache auto-nettoyant de 15 minutes
- Quand l'URL redirige vers un hôte différent, l'outil renvoie l'URL de redirection et il faut refaire la requête avec la nouvelle URL
- Si un outil web fetch fourni par MCP est disponible, préférer l'utiliser

## Signification dans cc-viewer

Les appels WebFetch apparaissent dans le journal des requêtes comme des paires de content blocks `tool_use` / `tool_result`. Le `tool_result` contient le résumé du contenu web traité par l'IA.

## Texte original

<textarea readonly>IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, you MUST use ToolSearch first to find a specialized tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
</textarea>
