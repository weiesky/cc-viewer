# SubAgent : Search

## Objectif

Le sous-agent Search est un agent d'exploration léger et en lecture seule. Dispatchez-le lorsque vous devez comprendre une base de code — trouver où quelque chose se trouve, apprendre comment les composants s'assemblent ou répondre à des questions structurelles — sans modifier aucun fichier. Il est optimisé pour de nombreuses petites lectures à travers de nombreux fichiers, en renvoyant un résumé concis plutôt qu'une sortie brute de recherche.

Search n'est pas un assistant polyvalent. Il ne peut pas éditer de code, exécuter des builds, valider des modifications ni ouvrir de connexions réseau au-delà de récupérations en lecture seule. Sa valeur réside dans sa capacité à brûler un gros budget d'exploration en parallèle sans consommer le contexte de l'agent principal, puis à renvoyer une réponse compacte.

## Quand l'utiliser

- Vous devez répondre à une question qui nécessite trois recherches ou lectures distinctes ou plus. Exemple : « Comment l'authentification est-elle câblée depuis la route de connexion jusqu'au stockage de session ? »
- La cible est inconnue — vous ne savez pas encore quel fichier, module ou symbole examiner.
- Vous avez besoin d'une vue d'ensemble structurelle d'une zone inconnue du dépôt avant d'effectuer des changements.
- Vous souhaitez croiser plusieurs candidats (par exemple, lequel de plusieurs helpers aux noms similaires est réellement appelé en production).
- Vous avez besoin d'un résumé de style revue de littérature : « liste chaque endroit qui importe X et catégorise par site d'appel. »

N'utilisez pas Search lorsque :

- Vous connaissez déjà le fichier et la ligne exacts. Appelez `Read` directement.
- Un seul `Grep` ou `Glob` répondra à la question. Exécutez-le directement ; dispatcher un sous-agent ajoute du surcoût.
- La tâche requiert édition, exécution de commandes ou tout effet de bord. Search est en lecture seule par conception.
- Vous avez besoin de la sortie verbatim exacte d'un appel d'outil. Les sous-agents résument ; ils ne proxient pas les résultats bruts.

## Niveaux de rigueur

Choisissez le niveau correspondant aux enjeux de la question.

- `quick` — quelques recherches ciblées, réponse au mieux. À utiliser lorsque vous avez besoin d'un pointeur rapide (par exemple, « où se trouve la logique de parsing des variables d'environnement ? ») et que vous êtes à l'aise pour itérer si la réponse est incomplète.
- `medium` — valeur par défaut. Plusieurs tours de recherche, recoupement de candidats et lecture intégrale des fichiers les plus pertinents. À utiliser pour les questions typiques « aide-moi à comprendre cette zone ».
- `very thorough` — exploration exhaustive. Le sous-agent poursuivra chaque piste plausible, lira le contexte environnant et vérifiera ses conclusions avant de résumer. À utiliser lorsque la correction importe (par exemple, revue de sécurité, planification de migration) ou lorsqu'une réponse incomplète causera du retravail.

Une rigueur plus élevée coûte plus de temps et de tokens à l'intérieur du sous-agent, mais ces tokens restent à l'intérieur du sous-agent — seul le résumé final revient à l'agent principal.

## Outils disponibles

Search a accès à tous les outils en lecture seule utilisés par l'agent principal, et rien d'autre :

- `Read` — pour lire des fichiers spécifiques, y compris des plages partielles.
- `Grep` — pour des recherches de contenu dans l'arbre.
- `Glob` — pour localiser des fichiers par motif de nom.
- `Bash` en mode lecture seule — pour des commandes qui inspectent l'état sans le muter (par exemple `git log`, `git show`, `ls`, `wc`).
- `WebFetch` et `WebSearch` — pour lire de la documentation externe lorsque ce contexte est requis.

Les outils d'édition (`Write`, `Edit`, `NotebookEdit`), les commandes shell qui modifient l'état, et les outils de graphe de tâches (`TaskCreate`, `TaskUpdate`, etc.) sont délibérément indisponibles.

## Notes

- Donnez au sous-agent Search une question spécifique, pas un sujet. « Liste chaque appelant de `renderMessage` et note ceux qui passent un thème personnalisé » renvoie une réponse utile ; « parle-moi du rendu » ne le fait pas.
- Le sous-agent renvoie un résumé. Si vous avez besoin de chemins de fichiers exacts, demandez-les explicitement dans votre invite.
- Plusieurs questions indépendantes sont mieux dispatchées comme des sous-agents Search parallèles plutôt qu'une longue invite, afin que chacun puisse se concentrer.
- Comme Search ne peut pas éditer, associez-le à une étape d'édition de suivi dans l'agent principal une fois que vous savez quoi changer.
- Traitez la sortie de Search comme une preuve, pas comme une vérité absolue. Pour tout ce qui est critique, ouvrez vous-même les fichiers cités avant d'agir.
