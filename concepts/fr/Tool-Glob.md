# Glob

## Définition

Outil rapide de correspondance de motifs de noms de fichiers, compatible avec des bases de code de toute taille. Renvoie les chemins de fichiers correspondants triés par date de modification.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `pattern` | string | Oui | Motif glob (comme `**/*.js`, `src/**/*.ts`) |
| `path` | string | Non | Répertoire de recherche, par défaut le répertoire de travail actuel. Ne pas passer « undefined » ou « null » |

## Cas d'utilisation

**Adapté pour :**
- Rechercher des fichiers par motif de nom
- Trouver tous les fichiers d'un type spécifique (comme tous les fichiers `.tsx`)
- Localiser des fichiers d'abord lors de la recherche de définitions de classes spécifiques (comme `class Foo`)
- Plusieurs appels Glob peuvent être lancés en parallèle dans un seul message

**Non adapté pour :**
- Rechercher du contenu de fichiers — utiliser Grep
- Exploration ouverte nécessitant plusieurs tours de recherche — utiliser Task (type Explore)

## Notes

- Supporte la syntaxe glob standard : `*` correspond à un niveau, `**` correspond à plusieurs niveaux, `{}` correspond à plusieurs choix
- Les résultats sont triés par date de modification
- Plus recommandé que la commande `find` de Bash

## Signification dans cc-viewer

Les appels Glob apparaissent dans le journal des requêtes comme des paires de content blocks `tool_use` / `tool_result`. Le `tool_result` contient la liste des chemins de fichiers correspondants.

## Texte original

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
