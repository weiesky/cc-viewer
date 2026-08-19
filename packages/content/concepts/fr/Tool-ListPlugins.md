# ListPlugins

Liste les plugins claude.ai activés de l'utilisateur, éventuellement filtrés par mot-clé.

## Quand l'utiliser

- Vous devez savoir quels plugins sont déjà activés — par exemple, pour confirmer ce qui a été installé après une carte `SuggestPluginInstall`.
- L'utilisateur demande quels plugins il possède.

## Activation

- Nécessite la permission d'accès au registre de plugins.
- La disponibilité dépend du type de session et du déploiement de fonctionnalité — désactivé dans les environnements HIPAA, toujours disponible dans les sessions distantes.

## Paramètres

- `keywords` (array de strings, optionnel) : filtre la liste — jusqu'à 8 éléments, 1 à 64 caractères chacun. Omettez pour tout lister.

## Exemples

### Exemple 1 : lister les plugins activés

```
ListPlugins()
```

### Exemple 2 : filtrer par mot-clé

```
ListPlugins(keywords=["figma"])
```

## Notes

- Si le catalogue de plugins est inaccessible (interdit), l'outil se replie sur une liste vide avec un avertissement plutôt que d'échouer.
