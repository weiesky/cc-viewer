# Bash

Exécute une commande shell dans un répertoire de travail persistant et renvoie sa sortie standard / erreur. À réserver aux opérations qu'aucun outil Claude Code dédié ne peut exprimer, comme l'exécution de git, npm, docker ou de scripts de build.

## Quand l'utiliser

- Exécuter des opérations git (`git status`, `git diff`, `git commit`, `gh pr create`)
- Lancer des gestionnaires de paquets et outils de build (`npm install`, `npm run build`, `pytest`, `cargo build`)
- Démarrer des processus de longue durée (serveurs de dev, watchers) en arrière-plan avec `run_in_background`
- Invoquer des CLI spécifiques à un domaine (`docker`, `terraform`, `kubectl`, `gh`) sans équivalent intégré
- Enchaîner des étapes dépendantes avec `&&` lorsque l'ordre compte

## Paramètres

- `command` (string, requis) : la commande shell exacte à exécuter.
- `description` (string, requis) : un bref résumé à la voix active (5 à 10 mots pour les commandes simples ; plus de contexte pour les commandes avec pipes ou obscures).
- `timeout` (number, optionnel) : délai d'expiration en millisecondes, jusqu'à `600000` (10 minutes). Par défaut `120000` (2 minutes).
- `run_in_background` (boolean, optionnel) : lorsque `true`, la commande s'exécute détachée et vous recevez une notification à l'achèvement. N'ajoutez pas vous-même `&`.

## Exemples

### Exemple 1 : inspecter l'état du dépôt avant de committer
Émettez `git status` et `git diff --stat` sous forme de deux appels `Bash` parallèles dans le même message pour rassembler rapidement le contexte, puis composez le commit dans un appel suivant.

### Exemple 2 : enchaîner des étapes de build dépendantes
Utilisez un unique appel tel que `npm ci && npm run build && npm test` afin que chaque étape ne s'exécute qu'après la réussite de la précédente. N'utilisez `;` que si vous souhaitez intentionnellement que les étapes suivantes s'exécutent même après un échec.

### Exemple 3 : serveur de dev de longue durée
Invoquez `npm run dev` avec `run_in_background: true`. Vous serez notifié à sa sortie. N'effectuez pas de polling avec des boucles `sleep` ; diagnostiquez les échecs au lieu de réessayer aveuglément.

## Notes

- Le répertoire de travail persiste entre les appels, mais l'état du shell (variables exportées, fonctions shell, alias) ne persiste pas. Préférez les chemins absolus et évitez `cd` sauf demande explicite de l'utilisateur.
- Préférez les outils dédiés aux équivalents shell avec pipes : `Glob` au lieu de `find`/`ls`, `Grep` au lieu de `grep`/`rg`, `Read` au lieu de `cat`/`head`/`tail`, `Edit` au lieu de `sed`/`awk`, `Write` au lieu de `echo >` ou des heredocs, et du texte d'assistant ordinaire au lieu de `echo`/`printf` pour les sorties destinées à l'utilisateur.
- Mettez entre guillemets doubles tout chemin contenant des espaces (par exemple `"/Users/me/My Project/file.txt"`).
- Pour des commandes indépendantes, effectuez plusieurs appels de l'outil `Bash` en parallèle dans un même message. Ne les chaînez avec `&&` que lorsqu'une commande dépend d'une autre.
- Toute sortie dépassant 30000 caractères est tronquée. Lorsque vous capturez de gros journaux, redirigez vers un fichier puis lisez-le avec l'outil `Read`.
- N'utilisez jamais d'options interactives telles que `git rebase -i` ou `git add -i` ; elles ne peuvent pas recevoir d'entrée via cet outil.
- Ne contournez pas les hooks git (`--no-verify`, `--no-gpg-sign`) et n'effectuez pas d'opérations destructrices (`reset --hard`, `push --force`, `clean -f`) sauf demande explicite de l'utilisateur.
