# getDiagnostics (mcp__ide__getDiagnostics)

## Définition

Obtient les informations de diagnostic du langage depuis VS Code, incluant les erreurs de syntaxe, erreurs de type, avertissements de lint, etc.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `uri` | string | Non | URI du fichier. Si non fourni, obtient les informations de diagnostic de tous les fichiers |

## Cas d'utilisation

**Adapté pour :**
- Vérifier les problèmes sémantiques de syntaxe, types, lint, etc. du code
- Vérifier si de nouvelles erreurs ont été introduites après l'édition du code
- Remplacer les commandes Bash pour vérifier la qualité du code

**Non adapté pour :**
- Exécuter des tests — utiliser Bash
- Vérifier les erreurs d'exécution — utiliser Bash pour exécuter le code

## Notes

- C'est un outil MCP (Model Context Protocol), fourni par l'intégration IDE
- Disponible uniquement dans les environnements VS Code / IDE
- Préférer cet outil aux commandes Bash pour vérifier les problèmes de code

## Signification dans cc-viewer

getDiagnostics est un outil MCP qui apparaît dans le tableau `tools` du journal des requêtes sous le nom `mcp__ide__getDiagnostics`. Ses appels et retours suivent le modèle standard `tool_use` / `tool_result`. L'ajout/suppression d'outils MCP entraîne des changements dans le tableau tools, ce qui peut déclencher la reconstruction du cache.

## Texte original

<textarea readonly>Get language diagnostics from VS Code</textarea>
