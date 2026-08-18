# ListSkills

Liste les skills claude.ai activées de l'utilisateur, éventuellement filtrées par mot-clé.

## Quand l'utiliser

- Vous avez besoin de la liste faisant autorité des skills actuellement activées — avant d'en invoquer une, ou pour confirmer ce qu'une carte `SuggestSkills` a ajouté.
- L'utilisateur demande quelles skills il possède.

## Activation

- Nécessite la permission d'accès au registre de plugins.
- Désactivé dans les environnements HIPAA.
- Toujours disponible dans les sessions distantes.

## Paramètres

- `keywords` (array de strings, optionnel) : filtre la liste — jusqu'à 8 éléments, 1 à 64 caractères chacun. Omettez pour tout lister.

## Exemples

### Exemple 1 : lister les skills activées

```
ListSkills()
```

### Exemple 2 : filtrer par mot-clé

```
ListSkills(keywords=["review"])
```

## Notes

- Si le catalogue est inaccessible (interdit), l'outil se replie sur une liste vide avec un avertissement plutôt que d'échouer.
- Ceci liste les skills *activées* ; utilisez `SuggestSkills` pour faire apparaître les skills que l'utilisateur pourrait ajouter.
