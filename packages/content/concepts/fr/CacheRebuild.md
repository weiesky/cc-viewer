# Cache Rebuild (Reconstruction du cache)

## Contexte

Le mécanisme de prompt caching d'Anthropic concatène séquentiellement system → tools → messages (jusqu'au cache breakpoint) de la requête pour former la clé de cache. Lorsque la clé de cache correspond exactement à la requête précédente, l'API renvoie `cache_read_input_tokens` (hit de cache) ; lorsque la clé de cache change, l'API recrée le cache et renvoie une grande quantité de `cache_creation_input_tokens`, c'est-à-dire une reconstruction du cache.

La reconstruction du cache implique une facturation supplémentaire de tokens (le prix du cache creation est supérieur à celui du cache read), donc identifier la cause de la reconstruction a une valeur directe pour l'optimisation des coûts.

## Classification des causes de reconstruction du cache

cc-viewer compare les corps de deux requêtes MainAgent consécutives pour déterminer précisément la cause de la reconstruction du cache :

| reason | Signification | Méthode de détermination |
|--------|---------------|--------------------------|
| `ttl` | Cache expiré | Plus de 5 minutes depuis la dernière requête MainAgent |
| `system_change` | Changement du system prompt | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Changement des définitions d'outils | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Changement de modèle | `prev.model !== curr.model` |
| `msg_truncated` | Pile de messages tronquée | La requête actuelle a moins de messages que la précédente, généralement dû à une troncature lors du dépassement de la fenêtre de contexte |
| `msg_modified` | Messages historiques modifiés | Le contenu des messages préfixe ne correspond pas (en ajout normal, le préfixe devrait être identique) |
| `key_change` | Changement de clé inconnu | Fallback lorsqu'aucune des conditions ci-dessus ne correspond |

## Priorité de détermination

1. On vérifie d'abord l'intervalle de temps — s'il dépasse 5 minutes, on détermine directement `ttl`, sans comparer le body
2. Ensuite on vérifie séquentiellement model, system, tools, messages
3. Une requête peut correspondre à plusieurs causes simultanément (par exemple, changement de modèle + changement de system prompt), auquel cas le tableau `reasons` contient tous les éléments correspondants et le tooltip les affiche sur des lignes séparées

## Scénarios courants

- **`ttl`** : L'utilisateur a mis en pause l'opération pendant plus de 5 minutes puis a continué, le cache a expiré naturellement
- **`system_change`** : Claude Code a mis à jour le system prompt (par exemple, chargement d'un nouveau CLAUDE.md, changements dans les project instructions)
- **`tools_change`** : La connexion/déconnexion d'un MCP server a causé des changements dans la liste des outils disponibles
- **`model_change`** : L'utilisateur a changé de modèle via la commande `/model`
- **`msg_truncated`** : Une conversation longue a déclenché la gestion de la fenêtre de contexte, Claude Code a tronqué les messages antérieurs
- **`msg_modified`** : Claude Code a édité des messages historiques (par exemple, `/compact` a remplacé les messages originaux par des résumés compressés)
