# Grep

## Définition

Puissant outil de recherche de contenu basé sur ripgrep. Supporte les expressions régulières, le filtrage par type de fichier et plusieurs modes de sortie.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `pattern` | string | Oui | Motif de recherche en expression régulière |
| `path` | string | Non | Chemin de recherche (fichier ou répertoire), par défaut le répertoire de travail actuel |
| `glob` | string | Non | Filtre de nom de fichier (comme `*.js`, `*.{ts,tsx}`) |
| `type` | string | Non | Filtre de type de fichier (comme `js`, `py`, `rust`), plus efficace que glob |
| `output_mode` | enum | Non | Mode de sortie : `files_with_matches` (par défaut), `content`, `count` |
| `-i` | boolean | Non | Recherche insensible à la casse |
| `-n` | boolean | Non | Afficher les numéros de ligne (mode content uniquement), par défaut true |
| `-A` | number | Non | Nombre de lignes à afficher après la correspondance |
| `-B` | number | Non | Nombre de lignes à afficher avant la correspondance |
| `-C` / `context` | number | Non | Nombre de lignes à afficher avant et après la correspondance |
| `head_limit` | number | Non | Limiter le nombre d'entrées en sortie, par défaut 0 (illimité) |
| `offset` | number | Non | Ignorer les N premiers résultats |
| `multiline` | boolean | Non | Activer le mode de correspondance multiligne, par défaut false |

## Cas d'utilisation

**Adapté pour :**
- Rechercher des chaînes ou motifs spécifiques dans la base de code
- Trouver les emplacements d'utilisation de fonctions/variables
- Filtrer les résultats de recherche par type de fichier
- Compter le nombre de correspondances

**Non adapté pour :**
- Rechercher des fichiers par nom — utiliser Glob
- Exploration ouverte nécessitant plusieurs tours de recherche — utiliser Task (type Explore)

## Notes

- Utilise la syntaxe ripgrep (pas grep), les caractères spéciaux comme les accolades doivent être échappés
- Le mode `files_with_matches` ne renvoie que les chemins de fichiers, c'est le plus efficace
- Le mode `content` renvoie le contenu des lignes correspondantes, supporte les lignes de contexte
- La correspondance multiligne nécessite de définir `multiline: true`
- Toujours préférer l'outil Grep aux commandes `grep` ou `rg` dans Bash

## Signification dans cc-viewer

Les appels Grep apparaissent dans le journal des requêtes comme des paires de content blocks `tool_use` / `tool_result`. Le `tool_result` contient les résultats de recherche.

## Texte original

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
