# WebSearch

## Définition

Exécute des requêtes sur les moteurs de recherche et renvoie des résultats de recherche pour obtenir des informations à jour.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `query` | string | Oui | Requête de recherche (minimum 2 caractères) |
| `allowed_domains` | string[] | Non | N'inclure que les résultats de ces domaines |
| `blocked_domains` | string[] | Non | Exclure les résultats de ces domaines |

## Cas d'utilisation

**Adapté pour :**
- Obtenir des informations à jour au-delà de la date de coupure des connaissances du modèle
- Rechercher des événements actuels et des données récentes
- Rechercher la documentation technique la plus récente

## Notes

- Les résultats de recherche sont renvoyés au format d'hyperliens markdown
- Après utilisation, une section « Sources: » doit être incluse à la fin de la réponse, listant les URLs pertinentes
- Supporte le filtrage de domaines (inclusion/exclusion)
- L'année en cours doit être utilisée dans les requêtes de recherche
- Disponible uniquement aux États-Unis

## Signification dans cc-viewer

Les appels WebSearch apparaissent dans le journal des requêtes comme des paires de content blocks `tool_use` / `tool_result`. Le `tool_result` contient la liste des résultats de recherche.

## Texte original

<textarea readonly>
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - This is MANDATORY - never skip including sources in your response
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites
  - Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
  - The current month is March 2026. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year
</textarea>
