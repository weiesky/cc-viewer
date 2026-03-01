# Write

## Définition

Écrit du contenu dans le système de fichiers local. Si le fichier existe déjà, il est écrasé.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `file_path` | string | Oui | Chemin absolu du fichier (doit être un chemin absolu) |
| `content` | string | Oui | Contenu à écrire |

## Cas d'utilisation

**Adapté pour :**
- Créer de nouveaux fichiers
- Quand il faut réécrire complètement le contenu d'un fichier

**Non adapté pour :**
- Modifier du contenu partiel d'un fichier — utiliser Edit
- Ne pas créer proactivement des fichiers de documentation (*.md) ou README, sauf si l'utilisateur le demande explicitement

## Notes

- Si le fichier cible existe déjà, il doit d'abord être lu avec Read, sinon l'opération échouera
- Écrase tout le contenu du fichier existant
- Préférer Edit pour éditer des fichiers existants, Write uniquement pour créer de nouveaux fichiers ou des réécritures complètes

## Signification dans cc-viewer

Les appels Write apparaissent dans le journal des requêtes comme des content blocks `tool_use`, dont `input.content` contient le contenu complet écrit.

## Texte original

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
