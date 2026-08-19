# ToolSearch

Récupère à la demande les définitions de schéma complètes des « outils différés » afin de les rendre appelables. Lorsque de nombreux outils sont disponibles, certains ne sont pas chargés d'emblée — ils n'apparaissent que par leur nom dans les messages `<system-reminder>`. Tant que son schéma n'est pas récupéré, seul le nom est connu et il n'existe aucune définition de paramètres, de sorte que l'outil ne peut pas être invoqué. `ToolSearch` prend une requête, la compare à la liste des outils différés et renvoie les définitions JSONSchema complètes des outils correspondants dans un bloc `<functions>`. Une fois que le schéma d'un outil apparaît dans le résultat, il est appelable exactement comme tout outil défini en haut du prompt.

## Quand l'utiliser

- Vous avez besoin d'un outil différé — son nom apparaît dans un `<system-reminder>`, mais il n'existe aucune définition de paramètres pour lui dans la liste d'outils de premier niveau.
- Vous voulez utiliser les outils d'un serveur MCP (p. ex. Slack, Gmail, computer-use) qui sont chargés à la demande.
- Vous n'êtes pas sûr du nom exact de l'outil correspondant à une capacité et vous voulez faire apparaître des candidats par mot-clé en une seule fois.

Si le schéma d'un outil est déjà dans le contexte, ne relancez pas de recherche — appelez-le simplement.

## Activation

- Activé par défaut.
- Désactivé lorsque `ANTHROPIC_BASE_URL` pointe vers un point de terminaison non Anthropic (sauf si `ENABLE_TOOL_SEARCH` est défini), lorsque `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` est défini, lorsque le modèle ne prend pas en charge les références d'outils (modèles Vertex AI antérieurs à Claude 4.5), ou lorsqu'il est refusé via `"deny": ["ToolSearch"]`.

## Paramètres

- `query` (string, requis) : la requête utilisée pour localiser les outils différés. Trois formes sont prises en charge :
  - `select:Read,Edit,Grep` — récupérer ces outils précis par leur nom.
  - `notebook jupyter` — recherche par mot-clé, renvoyant jusqu'à `max_results` meilleures correspondances.
  - `+slack send` — exiger que `slack` apparaisse dans le nom de l'outil, puis classer selon les termes restants.
- `max_results` (number, optionnel) : nombre maximal de résultats à renvoyer. Par défaut 5.

## Exemples

### Exemple 1 : récupération par nom exact

```
ToolSearch(query="select:WebFetch,WebSearch", max_results=5)
```

### Exemple 2 : recherche par mot-clé

```
ToolSearch(query="notebook jupyter", max_results=5)
```

### Exemple 3 : charger un kit d'outils MCP entier en une fois

Lors du chargement en masse de tous les outils d'un serveur MCP (p. ex. computer-use), utilisez une seule recherche par mot-clé plutôt que de sélectionner chacun d'eux — le nom du serveur en tant que sous-chaîne correspond à chaque outil de ce serveur :

```
ToolSearch(query="computer-use", max_results=30)
```

## Notes

- Avant d'invoquer un outil différé, vous devez d'abord récupérer son schéma avec `ToolSearch` — l'appeler directement échoue car la définition de paramètres est manquante.
- Lors du chargement en masse d'un kit d'outils complet (p. ex. tous les outils d'un serveur MCP), préférez une seule recherche par mot-clé à de nombreux appels `select:` pour réduire les allers-retours.
- Une fois le schéma récupéré, l'outil se comporte exactement comme n'importe quel outil normal ; ne relancez pas de recherche sur le même outil.
- Les résultats reviennent sous forme de bloc `<functions>`, chaque outil étant une seule ligne `<function>{...}</function>` — le même encodage que la liste d'outils de premier niveau.
