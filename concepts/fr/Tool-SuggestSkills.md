# SuggestSkills

Affiche une carte de skills autonomes que l'utilisateur peut ajouter (des skills qui ne sont pas encore activées), à partir de mots-clés de sujet.

## Quand l'utiliser

- La requête de l'utilisateur correspond à des skills qu'il n'a pas activées (`trigger="user_asked"` lorsqu'il l'a demandé, `trigger="proactive"` lorsque vous suggérez sans y être invité).

## Activation

- Uniquement lorsqu'un client Remote Control est connecté, ou lorsque la session s'exécute dans un environnement cloud géré.
- Désactivé sous les configurations d'entreprise HIPAA.
- Pas en mode brief.

## Paramètres

- `keywords` (array de strings, requis) : mots-clés de sujet tirés de la requête de l'utilisateur. 1 à 8 éléments, 1 à 64 caractères chacun.
- `contextLabel` (string, optionnel) : étiquette courte reliant la suggestion à la requête (max 128 caractères).
- `trigger` (string, optionnel) : comment cette suggestion a commencé — `user_asked` ou `proactive`.

## Exemples

### Exemple 1 : suggérer des skills par sujet

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Les skills déjà activées sont filtrées du résultat.

## Notes

- N'affiche qu'une carte de suggestion — l'ajout d'une skill se fait hors bande ; appelez `ListSkills` ensuite pour confirmer.
