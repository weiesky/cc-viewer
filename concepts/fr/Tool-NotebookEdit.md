# NotebookEdit

## Définition

Remplace, insère ou supprime des cellules spécifiques dans un Jupyter notebook (fichier .ipynb).

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `notebook_path` | string | Oui | Chemin absolu du fichier notebook |
| `new_source` | string | Oui | Nouveau contenu de la cellule |
| `cell_id` | string | Non | ID de la cellule à éditer. En mode insertion, la nouvelle cellule est insérée après cet ID |
| `cell_type` | enum | Non | Type de cellule : `code` ou `markdown`. Requis en mode insertion |
| `edit_mode` | enum | Non | Mode d'édition : `replace` (par défaut), `insert`, `delete` |

## Cas d'utilisation

**Adapté pour :**
- Modifier des cellules de code ou markdown dans des Jupyter notebooks
- Ajouter de nouvelles cellules à un notebook
- Supprimer des cellules d'un notebook

## Notes

- `cell_number` est indexé à partir de 0
- Le mode `insert` insère une nouvelle cellule à la position spécifiée
- Le mode `delete` supprime la cellule à la position spécifiée
- Le chemin doit être absolu

## Signification dans cc-viewer

Les appels NotebookEdit apparaissent dans le journal des requêtes comme des content blocks `tool_use`, enregistrant les opérations spécifiques de modification du notebook.

## Texte original

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
