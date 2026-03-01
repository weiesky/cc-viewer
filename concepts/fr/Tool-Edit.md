# Edit

## Définition

Édite des fichiers par remplacement exact de chaînes. Remplace `old_string` par `new_string` dans le fichier.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `file_path` | string | Oui | Chemin absolu du fichier à modifier |
| `old_string` | string | Oui | Texte original à remplacer |
| `new_string` | string | Oui | Nouveau texte de remplacement (doit être différent de old_string) |
| `replace_all` | boolean | Non | Si toutes les occurrences sont remplacées, par défaut `false` |

## Cas d'utilisation

**Adapté pour :**
- Modifier des segments de code spécifiques dans des fichiers existants
- Corriger des bugs, mettre à jour la logique
- Renommer des variables (avec `replace_all: true`)
- Tout scénario nécessitant une modification précise du contenu d'un fichier

**Non adapté pour :**
- Créer de nouveaux fichiers — utiliser Write
- Réécritures à grande échelle — peut nécessiter Write pour écraser le fichier entier

## Notes

- Le fichier doit avoir été lu préalablement avec Read, sinon une erreur sera retournée
- `old_string` doit être unique dans le fichier, sinon l'édition échoue. S'il n'est pas unique, fournir plus de contexte pour le rendre unique, ou utiliser `replace_all`
- Lors de l'édition du texte, l'indentation originale (tab/espaces) doit être conservée, ne pas inclure le préfixe de numéro de ligne de la sortie de Read
- Préférer l'édition de fichiers existants plutôt que la création de nouveaux
- `new_string` doit être différent de `old_string`

## Signification dans cc-viewer

Les appels Edit apparaissent dans le journal des requêtes comme des content blocks `tool_use`, dont l'`input` contient `old_string` et `new_string`, permettant de suivre les modifications apportées par le modèle aux fichiers.

## Texte original

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
