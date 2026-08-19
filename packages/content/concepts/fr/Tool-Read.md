# Read

Charge le contenu d'un unique fichier depuis le système de fichiers local. Prend en charge le texte brut, le code source, les images, les PDF et les notebooks Jupyter, en renvoyant les résultats avec des numéros de ligne commençant à 1, au style `cat -n`.

## Quand l'utiliser

- Lire un fichier source à un chemin connu avant édition ou analyse
- Inspecter des fichiers de configuration, des lockfiles, des journaux ou des artefacts générés
- Visualiser des captures d'écran ou des diagrammes que l'utilisateur a collés dans la conversation
- Extraire une plage de pages spécifique d'un long manuel PDF
- Ouvrir un notebook `.ipynb` pour examiner ensemble les cellules de code, le markdown et les sorties de cellules

## Paramètres

- `file_path` (string, requis) : chemin absolu du fichier cible. Les chemins relatifs sont rejetés.
- `offset` (integer, optionnel) : numéro de ligne (base 1) à partir duquel commencer la lecture. Utile pour les gros fichiers associés à `limit`.
- `limit` (integer, optionnel) : nombre maximal de lignes à renvoyer à partir de `offset`. Par défaut 2000 lignes depuis le début du fichier lorsqu'omis.
- `pages` (string, optionnel) : plage de pages pour les fichiers PDF, par exemple `"1-5"`, `"3"` ou `"10-20"`. Requis pour les PDF de plus de 10 pages ; maximum 20 pages par requête.

## Exemples

### Exemple 1 : lire un petit fichier entier
Appelez `Read` avec seulement `file_path` réglé sur `/Users/me/project/src/index.ts`. Jusqu'à 2000 lignes sont renvoyées avec numéros de ligne, ce qui suffit généralement pour le contexte d'édition.

### Exemple 2 : parcourir un long journal
Utilisez `offset: 5001` et `limit: 500` sur un fichier de journal de plusieurs milliers de lignes pour récupérer une fenêtre étroite sans gaspiller de tokens de contexte.

### Exemple 3 : extraire des pages PDF spécifiques
Pour un PDF de 120 pages situé à `/tmp/spec.pdf`, réglez `pages: "8-15"` pour n'extraire que le chapitre dont vous avez besoin. Omettre `pages` sur un grand PDF produit une erreur.

### Exemple 4 : visualiser une image
Passez le chemin absolu d'une capture d'écran PNG ou JPG. L'image est rendue visuellement afin que Claude Code puisse raisonner dessus directement.

## Notes

- Préférez toujours les chemins absolus. Si l'utilisateur en fournit un, faites-lui confiance tel quel.
- Les lignes de plus de 2000 caractères sont tronquées ; traitez le contenu renvoyé comme potentiellement coupé pour des données extrêmement larges.
- Vous lisez plusieurs fichiers indépendants ? Émettez plusieurs appels `Read` dans la même réponse afin qu'ils s'exécutent en parallèle.
- `Read` ne peut pas lister les répertoires. Utilisez un appel `Bash` `ls` ou l'outil `Glob` à la place.
- Lire un fichier existant mais vide renvoie un rappel système plutôt que les octets du fichier ; gérez ce signal explicitement.
- Un `Read` réussi est requis avant de pouvoir utiliser `Edit` sur le même fichier dans la session en cours.
