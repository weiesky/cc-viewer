# Référence des champs du corps de réponse

Référence des champs du corps de réponse de l'API Claude `/v1/messages`.

## Champs de niveau supérieur

| Champ | Type | Description |
|-------|------|-------------|
| **model** | string | Nom du modèle réellement utilisé, p. ex. `claude-opus-4-6` |
| **id** | string | Identifiant unique de cette réponse, p. ex. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Toujours `"message"` |
| **role** | string | Toujours `"assistant"` |
| **content** | array | Tableau de blocs de contenu générés par le modèle, contenant du texte, des appels d'outils, le processus de réflexion, etc. |
| **stop_reason** | string | Raison de l'arrêt : `"end_turn"` (fin normale), `"tool_use"` (exécution d'un outil requise), `"max_tokens"` (limite de tokens atteinte) |
| **stop_sequence** | string/null | La séquence ayant déclenché l'arrêt, généralement `null` |
| **usage** | object | Statistiques d'utilisation des tokens (voir ci-dessous) |

## Types de blocs content

| Type | Description |
|------|-------------|
| **text** | Réponse textuelle du modèle, contient un champ `text` |
| **tool_use** | Demande d'appel d'outil, contient `name` (nom de l'outil), `input` (paramètres), `id` (ID de l'appel, utilisé pour associer au tool_result) |
| **thinking** | Contenu de réflexion étendue (apparaît uniquement lorsque le mode de réflexion est activé), contient un champ `thinking` |

## Détail des champs usage

| Champ | Description |
|-------|-------------|
| **input_tokens** | Nombre de tokens d'entrée n'ayant pas atteint le cache (facturés au tarif plein) |
| **cache_creation_input_tokens** | Nombre de tokens pour les nouvelles entrées de cache créées (écriture en cache, facturation supérieure à l'entrée normale) |
| **cache_read_input_tokens** | Nombre de tokens ayant atteint le cache (lecture du cache, facturation bien inférieure à l'entrée normale) |
| **output_tokens** | Nombre de tokens générés par le modèle |
| **service_tier** | Niveau de service, p. ex. `"standard"` |
| **inference_geo** | Géographie d'inférence, p. ex. `"not_available"` indique qu'aucune information géographique n'est fournie |

## Sous-champs de cache_creation

| Champ | Description |
|-------|-------------|
| **ephemeral_5m_input_tokens** | Nombre de tokens de création de cache à court terme avec un TTL de 5 minutes |
| **ephemeral_1h_input_tokens** | Nombre de tokens de création de cache à long terme avec un TTL de 1 heure |

> **À propos de la facturation du cache** : Le prix unitaire de `cache_read_input_tokens` est bien inférieur à celui de `input_tokens`, tandis que le prix unitaire de `cache_creation_input_tokens` est légèrement supérieur à celui de l'entrée normale. Par conséquent, maintenir un taux de succès de cache élevé dans les conversations continues peut réduire considérablement les coûts. Vous pouvez surveiller visuellement ce ratio grâce à la métrique « Taux de succès » dans cc-viewer.

## Signification de stop_reason

- **end_turn** : Le modèle a terminé sa réponse normalement
- **tool_use** : Le modèle doit appeler un outil ; le contenu inclura un bloc `tool_use`. La requête suivante doit ajouter un `tool_result` dans les messages pour poursuivre la conversation
- **max_tokens** : La réponse a été tronquée en raison de l'atteinte de la limite `max_tokens` et peut être incomplète
