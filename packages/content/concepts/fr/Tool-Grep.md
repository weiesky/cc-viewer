# Grep

Recherche dans le contenu des fichiers en utilisant le moteur ripgrep. Offre une prise en charge complète des expressions régulières, un filtrage par type de fichier et trois modes de sortie pour arbitrer entre précision et compacité.

## Quand l'utiliser

- Localiser chaque site d'appel d'une fonction ou chaque référence à un identifiant
- Vérifier si une chaîne ou un message d'erreur apparaît quelque part dans la base de code
- Compter les occurrences d'un motif pour évaluer l'impact avant un refactoring
- Restreindre une recherche à un type de fichier (`type: "ts"`) ou à un glob (`glob: "**/*.tsx"`)
- Extraire des correspondances multilignes telles que des définitions de struct sur plusieurs lignes ou des blocs JSX avec `multiline: true`

## Paramètres

- `pattern` (string, requis) : expression régulière à rechercher. Utilise la syntaxe ripgrep, donc les accolades littérales doivent être échappées (par exemple `interface\{\}` pour trouver `interface{}`).
- `path` (string, optionnel) : fichier ou répertoire dans lequel chercher. Par défaut, le répertoire de travail courant.
- `glob` (string, optionnel) : filtre de nom de fichier tel que `*.js` ou `*.{ts,tsx}`.
- `type` (string, optionnel) : raccourci de type de fichier tel que `js`, `py`, `rust`, `go`. Plus efficace que `glob` pour les langages standards.
- `output_mode` (enum, optionnel) : `files_with_matches` (par défaut, renvoie uniquement les chemins), `content` (renvoie les lignes correspondantes) ou `count` (renvoie les totaux de correspondances).
- `-i` (boolean, optionnel) : correspondance insensible à la casse.
- `-n` (boolean, optionnel) : inclut les numéros de ligne en mode `content`. Par défaut `true`.
- `-A` (number, optionnel) : lignes de contexte à afficher après chaque correspondance (nécessite le mode `content`).
- `-B` (number, optionnel) : lignes de contexte avant chaque correspondance (nécessite le mode `content`).
- `-C` / `context` (number, optionnel) : lignes de contexte de chaque côté de chaque correspondance.
- `multiline` (boolean, optionnel) : permet aux motifs d'enjamber les sauts de ligne (`.` correspond à `\n`). Par défaut `false`.
- `head_limit` (number, optionnel) : limite les lignes, chemins de fichiers ou entrées de comptage renvoyés. Par défaut 250 ; passez `0` pour illimité (à utiliser avec parcimonie).
- `offset` (number, optionnel) : ignore les N premiers résultats avant d'appliquer `head_limit`. Par défaut `0`.

## Exemples

### Exemple 1 : trouver tous les sites d'appel d'une fonction
Réglez `pattern: "registerHandler\\("`, `output_mode: "content"` et `-C: 2` pour voir les lignes environnantes de chaque appel.

### Exemple 2 : compter les correspondances pour un type
Réglez `pattern: "TODO"`, `type: "py"` et `output_mode: "count"` pour voir les totaux de TODO par fichier dans les sources Python.

### Exemple 3 : correspondance de struct multiligne
Utilisez `pattern: "struct Config \\{[\\s\\S]*?version"` avec `multiline: true` pour capturer un champ déclaré plusieurs lignes à l'intérieur d'un struct Go.

## Notes

- Préférez toujours `Grep` à l'exécution de `grep` ou `rg` via `Bash` ; l'outil est optimisé pour des permissions correctes et une sortie structurée.
- Le mode de sortie par défaut est `files_with_matches`, le moins coûteux. Basculez vers `content` uniquement lorsque vous avez besoin de voir les lignes elles-mêmes.
- Les drapeaux de contexte (`-A`, `-B`, `-C`) sont ignorés sauf si `output_mode` est `content`.
- De gros ensembles de résultats consomment des tokens de contexte. Utilisez `head_limit`, `offset` ou des filtres `glob`/`type` plus serrés pour rester focalisé.
- Pour la découverte de noms de fichiers, utilisez `Glob` à la place ; pour des investigations ouvertes sur de nombreux tours, lancez une `Agent` avec l'agent Explore.
