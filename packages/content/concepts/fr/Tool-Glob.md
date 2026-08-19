# Glob

Fait correspondre les noms de fichiers à un motif glob et renvoie les chemins triés par date de modification la plus récente en premier. Optimisé pour localiser rapidement des fichiers dans des bases de code de toute taille sans passer par `find`.

## Quand l'utiliser

- Énumérer chaque fichier d'une extension spécifique (par exemple tous les fichiers `*.ts` sous `src`)
- Découvrir des fichiers de configuration ou de fixtures par convention de nommage (`**/jest.config.*`, `**/*.test.tsx`)
- Restreindre la surface de recherche avant d'exécuter un `Grep` ciblé
- Vérifier qu'un fichier existe déjà à un motif connu avant d'appeler `Write`
- Trouver les fichiers récemment modifiés en s'appuyant sur le tri par date de modification

## Paramètres

- `pattern` (string, requis) : expression glob à faire correspondre. Prend en charge `*` pour les jokers sur un seul segment, `**` pour les correspondances récursives, et `{a,b}` pour les alternatives, par exemple `src/**/*.{ts,tsx}`.
- `path` (string, optionnel) : répertoire dans lequel exécuter la recherche. Doit être un chemin de répertoire valide s'il est fourni. Omettez le champ entièrement pour rechercher dans le répertoire de travail courant. Ne passez pas les chaînes `"undefined"` ou `"null"`.

## Exemples

### Exemple 1 : chaque fichier source TypeScript
Appelez `Glob` avec `pattern: "src/**/*.ts"`. Le résultat est une liste triée par mtime, donc les fichiers édités le plus récemment apparaissent en premier, ce qui est utile pour se concentrer sur les points chauds.

### Exemple 2 : localiser une classe candidate
Lorsque vous soupçonnez qu'une classe réside dans un fichier dont vous ne connaissez pas le nom, cherchez avec `pattern: "**/*UserService*"` pour restreindre les candidats, puis enchaînez avec `Read` ou `Grep`.

### Exemple 3 : découverte parallèle avant une tâche plus large
Dans un unique message, émettez plusieurs appels `Glob` (par exemple un pour `**/*.test.ts` et un pour `**/fixtures/**`) afin qu'ils s'exécutent en parallèle et que leurs résultats puissent être corrélés.

## Notes

- Les résultats sont triés par date de modification du fichier (plus récent en premier), et non par ordre alphabétique. Triez en aval si vous avez besoin d'un ordre stable.
- Les motifs sont évalués par l'outil, et non par le shell ; vous n'avez pas besoin de les mettre entre guillemets ou de les échapper comme vous le feriez en ligne de commande.
- Pour une exploration ouverte nécessitant plusieurs tours de recherche et de raisonnement, déléguez à une `Agent` avec le type d'agent Explore plutôt que d'enchaîner de nombreux appels `Glob`.
- Préférez `Glob` aux invocations `Bash` de `find` ou `ls` pour la découverte de noms de fichiers ; il gère les permissions de façon cohérente et renvoie une sortie structurée.
- Lorsque vous cherchez du contenu à l'intérieur des fichiers plutôt que des noms de fichiers, utilisez `Grep` à la place.
