# Pourquoi les Tools sont-ils listés en premier ?

Dans le panneau Context de cc-viewer, **les Tools apparaissent avant le System Prompt et les Messages**. Cet ordre reflète précisément la **séquence de préfixe KV-Cache de l'API Anthropic**.

## Séquence de préfixe KV-Cache

Lorsque l'API Anthropic construit le KV-Cache, elle concatène le contexte en un préfixe dans cet **ordre fixe** :

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

Cela signifie que **les Tools se trouvent avant le System Prompt, tout au début du préfixe de cache**.

## Pourquoi les Tools ont-ils un poids de cache supérieur à System ?

Dans la correspondance de préfixe KV-Cache, **le contenu en début de séquence est plus critique** — toute modification invalide tout ce qui suit :

1. **La correspondance de préfixe commence par le début** : Le KV-Cache compare la requête actuelle au préfixe mis en cache token par token depuis le début. Dès qu'une divergence est détectée, tout le contenu suivant est invalidé.

2. **Modification des Tools = tout le cache invalidé** : Les Tools étant en première position, toute modification des définitions de tool (même l'ajout ou la suppression d'un seul MCP tool) **brise le préfixe dès le tout début**, invalidant tous les System Prompt et Messages mis en cache.

3. **Modification de System = cache des Messages invalidé** : Le System Prompt se trouve au milieu, donc ses modifications n'invalident que la portion Messages qui suit.

4. **Modification des Messages = seule la fin est affectée** : Les Messages sont à la fin, donc l'ajout de nouveaux messages n'invalide qu'un petit segment final — les caches Tools et System restent intacts.

## Impact pratique

| Type de modification | Impact sur le cache | Scénario typique |
|-------------|-------------|-----------------|
| Tool ajouté/supprimé | **Invalidation complète** | Connexion/déconnexion d'un serveur MCP, activation/désactivation d'un plugin IDE |
| Modification du System Prompt | Cache des Messages perdu | Édition de CLAUDE.md, injection de system reminder |
| Nouveau message ajouté | Incrément de queue uniquement | Flux de conversation normal (le plus fréquent, le moins coûteux) |

C'est pourquoi `tools_change` dans [CacheRebuild](CacheRebuild.md) tend à être la raison de reconstruction la plus coûteuse — elle brise la chaîne de préfixe dès le tout début.

## Pourquoi les définitions d'outils sont-elles placées avant le « cerveau » ?

Du point de vue du cache, le fait que les Tools soient en premier est un fait technique. Mais du point de vue de la conception cognitive, cet ordre est tout aussi logique — **les Tools sont les mains et les pieds, le System Prompt est le cerveau**.

Avant d'agir, une personne doit percevoir quels membres et outils sont à sa disposition. Un nourrisson ne comprend pas d'abord les règles du monde (System) avant d'apprendre à saisir — il perçoit d'abord qu'il a des mains et des pieds, puis comprend progressivement les règles par l'interaction avec son environnement. De même, un LLM doit savoir quels outils il peut appeler (lire des fichiers, écrire du code, rechercher, exécuter des commandes) avant de recevoir les instructions de tâche (System Prompt), afin de pouvoir évaluer précisément « que puis-je faire » et « comment dois-je procéder » lors du traitement des instructions.

Si l'ordre était inversé — dire d'abord au modèle « ta tâche est de refactoriser ce module », puis lui dire « tu disposes des outils Read, Edit, Bash » — le modèle manquerait d'informations cruciales sur les limites de ses capacités lors de la compréhension de la tâche, produisant potentiellement des plans irréalistes ou omettant des approches disponibles.

**Connaître ses cartes avant de décider comment jouer.** Voilà la logique cognitive derrière le placement des Tools avant le System.

## Pourquoi les outils MCP sont-ils aussi à cette position ?

Les outils MCP (Model Context Protocol), comme les outils intégrés, sont placés tout au début de la zone Tools. Comprendre la position de MCP dans le contexte aide à évaluer ses véritables avantages et coûts.

### Avantages de MCP

- **Extension des capacités** : MCP permet aux modèles d'accéder à des services externes (requêtes base de données, appels API, opérations IDE, contrôle de navigateur, etc.), dépassant les limites des outils intégrés
- **Écosystème ouvert** : N'importe qui peut implémenter un serveur MCP ; le modèle acquiert de nouvelles capacités sans réentraînement
- **Chargement à la demande** : Les serveurs MCP peuvent être connectés/déconnectés sélectivement selon le scénario, composant des ensembles d'outils flexibles

### Coûts de MCP

- **Tueur de cache** : La définition JSON Schema de chaque outil MCP est concaténée au tout début du préfixe KV-Cache. Ajouter ou supprimer un seul outil MCP = **tout le cache est invalidé depuis le début**. Connecter/déconnecter fréquemment des serveurs MCP réduit considérablement le taux de succès du cache
- **Gonflement du préfixe** : Les Schemas des outils MCP sont généralement plus volumineux que ceux des outils intégrés (descriptions détaillées des paramètres, énumérations, etc.). De nombreux outils MCP augmentent significativement le nombre de tokens de la zone Tools, réduisant l'espace de contexte disponible pour les Messages
- **Surcoût de latence** : Les appels d'outils MCP nécessitent une communication inter-processus (JSON-RPC via stdio/SSE), un ordre de grandeur plus lent que les appels de fonctions intégrées
- **Risque de stabilité** : Les serveurs MCP sont des processus externes qui peuvent planter, expirer ou retourner des formats inattendus, nécessitant une gestion d'erreurs supplémentaire

### Recommandations pratiques

| Scénario | Recommandation |
|----------|---------------|
| Conversations longues, interactions fréquentes | Minimiser le nombre d'outils MCP pour protéger la stabilité du préfixe de cache |
| Tâches courtes, opérations ponctuelles | Utiliser librement les outils MCP ; l'impact sur le cache est limité |
| Ajout/suppression fréquent de serveurs MCP | Chaque changement déclenche une reconstruction complète du cache ; envisager de fixer l'ensemble d'outils |
| Schemas d'outils surdimensionnés | Réduire les descriptions et énumérations pour diminuer l'empreinte en tokens du préfixe |

Dans le panneau Context de cc-viewer, les outils MCP sont affichés aux côtés des outils intégrés dans la zone Tools, offrant une vue claire de la taille du Schema de chaque outil et de sa contribution au préfixe de cache.
