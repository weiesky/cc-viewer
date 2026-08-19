# ListConnectors

Liste les connecteurs MCP installés pour l'organisation claude.ai de l'utilisateur, éventuellement filtrés par mot-clé.

## Quand l'utiliser

- Vous devez savoir quels connecteurs sont déjà installés avant d'en suggérer de nouveaux.
- L'utilisateur demande quelles intégrations son organisation possède.

## Activation

- Disponible uniquement dans les sessions distantes (claude.ai) sur l'API first-party.

## Paramètres

- `keywords` (array de strings, optionnel) : filtre la liste — jusqu'à 8 éléments, 1 à 64 caractères chacun. Omettez pour tout lister.

## Exemples

### Exemple 1 : lister tous les connecteurs installés

```
ListConnectors()
```

### Exemple 2 : filtrer par mot-clé

```
ListConnectors(keywords=["github"])
```

## Notes

- Associez à `SearchMcpRegistry` (découverte) et `SuggestConnectors` (détails) pour le flux complet trouver-et-activer.
