# Read

## Définition

Lit le contenu de fichiers depuis le système de fichiers local. Supporte les fichiers texte, images, PDF et Jupyter notebook.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `file_path` | string | Oui | Chemin absolu du fichier |
| `offset` | number | Non | Numéro de ligne de départ (pour la lecture segmentée de gros fichiers) |
| `limit` | number | Non | Nombre de lignes à lire (pour la lecture segmentée de gros fichiers) |
| `pages` | string | Non | Plage de pages PDF (comme « 1-5 », « 3 », « 10-20 »), applicable uniquement aux PDF |

## Cas d'utilisation

**Adapté pour :**
- Lire des fichiers de code, fichiers de configuration et autres fichiers texte
- Visualiser des fichiers image (Claude est un modèle multimodal)
- Lire des documents PDF
- Lire des Jupyter notebooks (renvoie toutes les cellules et sorties)
- Lire plusieurs fichiers en parallèle pour obtenir du contexte

**Non adapté pour :**
- Lire des répertoires — utiliser la commande `ls` de Bash
- Exploration ouverte de la base de code — utiliser Task (type Explore)

## Notes

- Le chemin doit être absolu, pas relatif
- Par défaut, lit les 2000 premières lignes du fichier
- Les lignes dépassant 2000 caractères seront tronquées
- La sortie utilise le format `cat -n`, les numéros de ligne commencent à 1
- Les gros PDF (plus de 10 pages) doivent spécifier le paramètre `pages`, maximum 20 pages par requête
- Lire un fichier inexistant renvoie une erreur (pas de plantage)
- Plusieurs appels Read peuvent être effectués en parallèle dans un seul message

## Signification dans cc-viewer

Les appels Read apparaissent dans le journal des requêtes comme des paires de content blocks `tool_use` (appel) et `tool_result` (contenu renvoyé). Le `tool_result` contient le contenu réel du fichier, permettant d'analyser quels fichiers le modèle a lus.

## Texte original

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
