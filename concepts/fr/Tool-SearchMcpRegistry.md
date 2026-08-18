# SearchMcpRegistry

Recherche dans le registre de connecteurs MCP par mot-clé pour découvrir des connecteurs susceptibles d'aider à accomplir la tâche.

## Quand l'utiliser

- La tâche bénéficierait d'un service externe (une base de données, un suivi d'issues, une API SaaS) et vous voulez vérifier s'il existe un connecteur MCP pour cela.
- L'utilisateur nomme un produit et demande de le connecter — recherchez dans le registre un connecteur correspondant.

## Activation

- Disponible uniquement dans les sessions distantes (claude.ai) sur l'API first-party.

## Paramètres

- `keywords` (array de strings, requis) : expressions de mots-clés décrivant l'intention de l'utilisateur ou un produit nommé. 1 à 8 éléments, 1 à 64 caractères chacun.

## Exemples

### Exemple 1 : trouver un connecteur pour un produit nommé

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Renvoie les entrées du registre dont les connecteurs correspondent aux mots-clés. Résolvez les détails complets des connecteurs avec `SuggestConnectors`.

## Notes

- Lecture seule et sûr en concurrence ; les résultats sont plafonnés en taille.
- La recherche n'installe rien — c'est purement de la découverte.
