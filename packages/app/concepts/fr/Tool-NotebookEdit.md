# NotebookEdit

Modifie une seule cellule d'un notebook Jupyter (`.ipynb`). Prend en charge le remplacement du code source d'une cellule, l'insertion d'une nouvelle cellule ou la suppression d'une cellule existante tout en préservant le reste de la structure du notebook.

## Quand l'utiliser

- Corriger ou mettre à jour une cellule de code dans un notebook d'analyse sans réécrire l'intégralité du fichier
- Remplacer une cellule markdown pour améliorer la narration ou ajouter de la documentation
- Insérer une nouvelle cellule de code ou markdown à une position connue dans un notebook existant
- Supprimer une cellule obsolète ou cassée afin que les cellules en aval n'en dépendent plus
- Préparer un notebook reproductible en itérant sur les cellules une à une

## Paramètres

- `notebook_path` (string, requis) : chemin absolu du fichier `.ipynb`. Les chemins relatifs sont rejetés.
- `new_source` (string, requis) : le nouveau code source de la cellule. Pour `replace` et `insert`, il devient le corps de la cellule ; pour `delete`, il est ignoré mais reste requis par le schéma.
- `cell_id` (string, optionnel) : ID de la cellule cible. Dans les modes `replace` et `delete`, l'outil agit sur cette cellule. En mode `insert`, la nouvelle cellule est insérée immédiatement après la cellule avec cet ID ; omettez-le pour insérer en haut du notebook.
- `cell_type` (enum, optionnel) : soit `code`, soit `markdown`. Requis lorsque `edit_mode` est `insert`. Lorsqu'omis pendant un `replace`, le type de la cellule existante est préservé.
- `edit_mode` (enum, optionnel) : `replace` (par défaut), `insert` ou `delete`.

## Exemples

### Exemple 1 : remplacer une cellule de code boguée
Appelez `NotebookEdit` avec `notebook_path` réglé sur le chemin absolu, `cell_id` sur l'ID de la cellule cible, et `new_source` contenant le code Python corrigé. Laissez `edit_mode` à sa valeur par défaut `replace`.

### Exemple 2 : insérer une explication markdown
Pour ajouter une cellule markdown juste après une cellule existante `setup`, réglez `edit_mode: "insert"`, `cell_type: "markdown"`, `cell_id` sur l'ID de la cellule setup, et mettez le texte explicatif dans `new_source`.

### Exemple 3 : supprimer une cellule obsolète
Réglez `edit_mode: "delete"` et fournissez le `cell_id` de la cellule à supprimer. Fournissez n'importe quelle chaîne pour `new_source` ; elle n'est pas appliquée.

## Notes

- Passez toujours un chemin absolu. `NotebookEdit` ne résout pas les chemins relatifs par rapport au répertoire de travail.
- L'outil ne réécrit que la cellule ciblée ; les compteurs d'exécution, sorties et métadonnées des cellules sans rapport restent intacts.
- Insérer sans `cell_id` place la nouvelle cellule tout au début du notebook.
- `cell_type` est obligatoire pour les insertions. Pour les remplacements, omettez-le sauf si vous voulez explicitement convertir une cellule de code en markdown ou vice versa.
- Pour inspecter les cellules et récupérer leurs IDs, utilisez d'abord l'outil `Read` sur le notebook ; il renvoie les cellules avec leur contenu et leurs sorties.
- Utilisez `Edit` habituel pour les fichiers source ordinaires ; `NotebookEdit` est spécifique au JSON `.ipynb` et comprend sa structure de cellules.
