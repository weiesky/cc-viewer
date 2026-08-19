# Contenu du Cache KV

## Qu'est-ce que le Prompt Caching ?

Lorsque tu communiques avec Claude, chaque requete API envoie le contexte complet de la conversation (prompt systeme + definitions d'outils + messages historiques). Le mecanisme de prompt caching d'Anthropic met en cache le contenu du prefixe deja calcule cote serveur. Si le prefixe d'une requete ulterieure correspond, le resultat en cache est reutilise directement, evitant les calculs redondants et reduisant considerablement la latence et les couts.

Dans cc-viewer, ce mecanisme est appele "KV-Cache", correspondant au prompt caching au niveau de l'API d'Anthropic, et non au cache key-value au sein des couches d'attention du transformer du LLM lui-meme.

## Comment fonctionne le cache

Le prompt caching d'Anthropic concatene les cles de cache dans un ordre fixe :

```
Outils → Prompt systeme → Messages (jusqu'au point de rupture du cache)
```

Tant que ce prefixe correspond exactement a n'importe quelle requete dans la fenetre TTL, l'API atteint le cache (retourne `cache_read_input_tokens`) au lieu de recalculer (`cache_creation_input_tokens`).

> **Claude Code ne depend pas fortement de l'attribut `cache_control`. Le serveur supprimera certains de ces attributs en consequence, mais la mise en cache fonctionne toujours correctement. Donc ne pas voir `cache_control` ne signifie pas que le contenu n'est pas mis en cache.**
>
> Pour les clients speciaux comme Claude Code, le serveur d'Anthropic ne s'appuie pas entierement sur l'attribut `cache_control` dans les requetes pour determiner le comportement de la mise en cache. Le serveur applique automatiquement des politiques de cache a des champs specifiques (comme le prompt systeme et les definitions d'outils), meme lorsque la requete ne contient pas explicitement de marqueurs `cache_control`. Par consequent, lorsque tu ne vois pas cet attribut dans le corps de la requete, ne sois pas perplexe — le serveur a deja effectue l'operation de mise en cache en coulisses, il n'a simplement pas expose cette information au client. C'est une entente tacite entre Claude Code et l'API d'Anthropic.

## Qu'est-ce que le "contenu actuel du cache KV" ?

Le "contenu actuel du cache KV" affiche dans cc-viewer est extrait de la derniere requete MainAgent, specifiquement le contenu avant la limite du cache (cache breakpoint). Il comprend :

- **Prompt systeme** : Les instructions systeme de Claude Code, incluant les directives centrales de l'agent, les specifications d'utilisation des outils, les instructions du projet CLAUDE.md, les informations d'environnement, etc.
- **Outils** : La liste actuelle des definitions d'outils disponibles (comme Read, Write, Bash, Agent, outils MCP, etc.)
- **Messages** : La partie mise en cache de l'historique de conversation (generalement les messages anterieurs, jusqu'au dernier marqueur `cache_control`)

## Pourquoi consulter le contenu du cache ?

1. **Comprendre le contexte** : Voir ce que Claude "se souvient" actuellement pour evaluer si son comportement correspond aux attentes
2. **Optimisation des couts** : Les acces au cache coutent beaucoup moins cher que le recalcul. Consulter le contenu du cache t'aide a comprendre pourquoi certaines requetes ont declenche une reconstruction du cache
3. **Debogage de conversations** : Quand les reponses de Claude ne correspondent pas aux attentes, verifier le contenu du cache permet de confirmer que le prompt systeme et les messages historiques sont corrects
4. **Surveillance de la qualite du contexte** : Lors du debogage, des modifications de configuration ou des ajustements de prompt, KV-Cache-Text offre une vue centralisee pour confirmer rapidement si le contexte principal s'est degrade ou a ete pollue de maniere inattendue — sans avoir a examiner les messages bruts un par un

## Strategie de cache multiniveau

Le KV-Cache correspondant a Claude Code n'est pas un cache unique. Le serveur genere des caches separees pour les Outils et le Prompt systeme, independantes du cache des Messages. L'avantage de cette conception est : lorsque la pile de messages est corrompue (par exemple, troncature de contexte, modification de messages) et necessite une reconstruction, cela n'invalide pas les caches des Outils et du Prompt systeme en meme temps, evitant un recalcul complet.

C'est une strategie d'optimisation actuelle cote serveur — car les definitions d'outils et le prompt systeme restent relativement stables pendant l'utilisation normale et changent rarement. Les mettre en cache separement minimise les frais de reconstruction inutiles. Ainsi, lorsque tu observes le cache, tu remarqueras qu'a part les reconstructions d'outils qui necessitent un rafraichissement complet du cache, les perturbations du prompt systeme et des messages disposent toujours de caches heritables disponibles.

## Cycle de vie du cache

- **Creation** : Lors de la premiere requete ou apres l'expiration du cache, l'API cree un nouveau cache (`cache_creation_input_tokens`)
- **Acces** : Lors des requetes suivantes avec un prefixe correspondant, le cache est reutilise (`cache_read_input_tokens`)
- **Expiration** : Le cache a une TTL (duree de vie) de 5 minutes et expire automatiquement apres ce delai
- **Reconstruction** : Quand le prompt systeme, la liste des outils, le modele ou le contenu des messages changent, la cle du cache ne correspond plus et declenche une reconstruction au niveau correspondant
