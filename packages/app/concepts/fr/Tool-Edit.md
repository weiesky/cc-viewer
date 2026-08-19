# Edit

Effectue un remplacement exact de chaîne dans un fichier existant. C'est la méthode privilégiée pour modifier des fichiers car seul le diff est transmis, ce qui rend les modifications précises et auditables.

## Quand l'utiliser

- Corriger un bug dans une fonction sans réécrire le fichier qui l'entoure
- Mettre à jour une valeur de configuration, une chaîne de version ou un chemin d'import
- Renommer un symbole dans un fichier avec `replace_all`
- Insérer un bloc près d'une ancre (étendez `old_string` pour inclure du contexte voisin, puis fournissez le remplacement)
- Appliquer de petites modifications bien cadrées dans le cadre d'un refactoring en plusieurs étapes

## Paramètres

- `file_path` (string, requis) : chemin absolu du fichier à modifier.
- `old_string` (string, requis) : texte exact à rechercher. Doit correspondre caractère pour caractère, y compris espaces et indentation.
- `new_string` (string, requis) : texte de remplacement. Doit différer de `old_string`.
- `replace_all` (boolean, optionnel) : lorsque `true`, remplace chaque occurrence de `old_string`. Par défaut `false`, ce qui exige que la correspondance soit unique.

## Exemples

### Exemple 1 : corriger un unique site d'appel
Réglez `old_string` sur la ligne exacte `const port = 3000;` et `new_string` sur `const port = process.env.PORT ?? 3000;`. La correspondance étant unique, `replace_all` peut rester à sa valeur par défaut.

### Exemple 2 : renommer un symbole dans un fichier
Pour renommer `getUser` en `fetchUser` partout dans `api.ts`, réglez `old_string: "getUser"`, `new_string: "fetchUser"`, et `replace_all: true`.

### Exemple 3 : désambiguïser un extrait répété
Si `return null;` apparaît dans plusieurs branches, élargissez `old_string` pour inclure le contexte environnant (par exemple la ligne `if` précédente) afin que la correspondance soit unique. Sinon l'outil renvoie une erreur plutôt que de deviner.

## Notes

- Vous devez appeler `Read` sur le fichier au moins une fois dans la session en cours avant que `Edit` n'accepte des changements. Les préfixes de numéro de ligne de la sortie de `Read` ne font pas partie du contenu du fichier ; ne les incluez pas dans `old_string` ou `new_string`.
- Les espaces doivent correspondre exactement. Prêtez attention aux tabulations versus espaces et aux espaces de fin, en particulier dans YAML, les Makefiles et Python.
- Si `old_string` n'est pas unique et que `replace_all` est `false`, l'édition échoue. Élargissez le contexte ou activez `replace_all`.
- Préférez `Edit` à `Write` chaque fois que le fichier existe déjà ; `Write` écrase tout le fichier et perd le contenu sans rapport si vous n'êtes pas prudent.
- Pour plusieurs modifications sans rapport dans le même fichier, effectuez plusieurs appels `Edit` à la suite plutôt qu'un seul gros remplacement fragile.
- Évitez d'introduire des emojis, du texte marketing ou des blocs de documentation non demandés lors de l'édition de fichiers source.
