# WebSearch

Effectue une recherche web en direct et renvoie des résultats classés que l'assistant utilise pour ancrer sa réponse dans des informations actuelles au-delà de la date limite d'entraînement du modèle.

## Quand l'utiliser

- Répondre à des questions sur des événements actuels, des versions récentes ou des actualités de dernière minute.
- Consulter la dernière version d'une bibliothèque, d'un framework ou d'un outil CLI.
- Trouver de la documentation ou des articles de blog lorsque l'URL exacte est inconnue.
- Vérifier un fait qui peut avoir changé depuis l'entraînement du modèle.
- Découvrir plusieurs perspectives sur un sujet avant de récupérer une page unique avec `WebFetch`.

## Activation

- La disponibilité dépend du fournisseur et du modèle : disponible sur l'API Anthropic et Claude Platform on AWS ; sur Microsoft Foundry, elle nécessite un déploiement hébergé par Anthropic ; sur Google Cloud, elle fonctionne avec les modèles Claude 4+.
- Non disponible sur Amazon Bedrock.
- Plafonnez à 200 appels par session avec `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

## Paramètres

- `query` (string, requis) : la requête de recherche. Longueur minimale de 2 caractères. Incluez l'année courante lorsque vous posez des questions sur des informations « latest » ou « recent » afin que les résultats soient frais.
- `allowed_domains` (array de strings, optionnel) : limite les résultats à ces domaines uniquement, par exemple `["nodejs.org", "developer.mozilla.org"]`. Utile lorsque vous faites confiance à une source spécifique.
- `blocked_domains` (array de strings, optionnel) : exclut les résultats de ces domaines. Ne passez pas le même domaine à la fois à `allowed_domains` et `blocked_domains`.

## Exemples

### Exemple 1 : recherche de version avec l'année courante

```
WebSearch(
  query="React 19 stable release date 2026",
  allowed_domains=["react.dev", "github.com"]
)
```

Renvoie les annonces officielles et évite les sites agrégateurs de faible qualité.

### Exemple 2 : exclure les sources bruyantes

```
WebSearch(
  query="kubernetes ingress-nginx CVE April 2026",
  blocked_domains=["pinterest.com", "medium.com"]
)
```

Garde les résultats concentrés sur les avis des fournisseurs et les trackers de sécurité.

## Notes

- Lorsque vous utilisez `WebSearch` dans une réponse, vous devez ajouter une section `Sources:` à la fin de votre réponse listant chaque résultat cité sous forme d'hyperlien Markdown au format `[Title](URL)`. C'est une exigence stricte, pas optionnelle.
- `WebSearch` n'est disponible que pour les utilisateurs aux États-Unis. Si l'outil est indisponible dans votre région, repliez-vous sur `WebFetch` contre une URL connue ou demandez à l'utilisateur de coller le contenu pertinent.
- Chaque appel effectue la recherche en un seul aller-retour — vous ne pouvez pas streamer ni paginer. Affinez la requête si le premier ensemble de résultats est hors cible.
- L'outil renvoie des extraits et des métadonnées, pas le contenu complet des pages. Pour lire en profondeur un résultat spécifique, enchaînez avec `WebFetch` en utilisant l'URL renvoyée.
- Utilisez `allowed_domains` pour imposer un sourcing autoritaire sur les questions de sécurité sensibles telles que les CVE ou la conformité, et `blocked_domains` pour éliminer les fermes SEO qui recopient la documentation.
- Gardez les requêtes courtes et basées sur des mots-clés. Les questions en langage naturel fonctionnent mais tendent à renvoyer des réponses conversationnelles plutôt que des sources primaires.
- N'inventez pas d'URL basées sur l'intuition de recherche — exécutez toujours la recherche et citez ce que l'outil a réellement renvoyé.
