# LSP

Interroge les serveurs Language Server Protocol (LSP) pour obtenir de l'intelligence de code — définitions, références, info-bulles, symboles, implémentations et hiérarchie d'appels. Plus précis qu'une recherche textuelle, car il comprend le code de manière sémantique.

## Quand l'utiliser

- Sauter à la définition d'un symbole (`goToDefinition`) ou trouver chacune de ses références (`findReferences`)
- Lire les signatures de types / la documentation d'un symbole (`hover`)
- Lister les symboles d'un fichier (`documentSymbol`) ou les rechercher dans tout le projet (`workspaceSymbol`)
- Trouver les implémentations d'une interface ou d'une méthode abstraite (`goToImplementation`)
- Parcourir la hiérarchie d'appels d'une fonction (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Activation

- Inactif jusqu'à ce qu'un plugin d'intelligence de code pour le langage soit installé (le binaire du serveur est installé séparément).
- L'outil n'apparaît que lorsqu'un client LSP est connecté.

## Paramètres

- `operation` (string, requis) : l'une des opérations énumérées ci-dessus.
- `filePath` (string, requis) : le fichier sur lequel opérer.
- `line` (number, requis) : numéro de ligne commençant à 1, tel qu'affiché dans l'éditeur.
- `character` (number, requis) : décalage de caractère commençant à 1, tel qu'affiché dans l'éditeur.

## Notes

- Nécessite un serveur LSP configuré pour ce type de fichier ; sinon, l'appel renvoie une erreur.
- La ligne et le caractère commencent à 1 (coordonnées de l'éditeur), pas à 0.
- Préférez LSP à `Grep` lorsque vous avez besoin d'une navigation sémantique (définition/référence réelle) plutôt que d'une correspondance textuelle.

## Concepts associés

- Complète `Read` et `Edit` lors de la navigation dans le code et de sa modification.
