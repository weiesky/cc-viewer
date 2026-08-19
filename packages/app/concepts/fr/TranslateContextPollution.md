# Pollution de contexte de l'API de traduction

## Contexte

CC-Viewer intègre une fonctionnalité de traduction (`POST /api/translate`) alimentée par l'API Messages d'Anthropic. Dans l'implémentation initiale, les requêtes de traduction réutilisaient les identifiants d'authentification mis en cache de la session Claude Code — incluant les en-têtes `x-api-key` et `authorization`. Cela a provoqué un problème subtil mais grave : les résultats de traduction renvoyaient fréquemment du contenu sans rapport.

## Cause profonde

### Différence fondamentale entre les deux méthodes d'authentification

L'API Anthropic prend en charge deux méthodes d'authentification :

| Méthode | En-tête | Source typique | Caractéristiques |
|---------|---------|----------------|------------------|
| Clé API | `x-api-key: sk-ant-...` | Variable d'environnement / Console | Sans état, chaque requête est indépendante |
| Jeton OAuth | `authorization: Bearer sessionToken` | Connexion par abonnement Claude Code | Lié à la session, le serveur maintient l'association de contexte |

La différence clé : **les clés API sont sans état** — chaque requête est complètement indépendante ; tandis que **les jetons de session OAuth sont avec état** — le serveur Anthropic associe les requêtes utilisant le même jeton au même contexte de session.

### Chaîne de pollution

Lorsque Claude Code utilise la connexion OAuth par abonnement, le flux d'authentification se présente ainsi :

```
Conversation principale Claude Code ──(authorization: Bearer sessionToken)──→ Anthropic API
                                                                                ↑
Requête de traduction CC-Viewer ──(authorization: Bearer sessionToken)──→ Anthropic API
```

Étant donné que les requêtes de traduction réutilisaient le même jeton de session, le serveur Anthropic pouvait associer les requêtes de traduction au contexte de la conversation principale de Claude Code. Cela entraîne :

1. **Les résultats de traduction sont influencés par le contexte de la conversation principale** : Le prompt système de la requête de traduction est « vous êtes un traducteur », mais le contexte serveur contient toujours l'historique de conversation de Claude Code, ce qui peut interférer avec le modèle
2. **La conversation principale est perturbée par les requêtes de traduction** : Le contenu des requêtes de traduction (fragments de texte d'interface) peut être injecté dans le contexte de la conversation principale, provoquant des déviations dans les réponses de Claude Code
3. **Comportement imprévisible** : La pollution de contexte étant un comportement côté serveur, le client ne peut ni la détecter ni la contrôler

## Leçons retenues

- **Les jetons de session OAuth ne sont pas « juste une autre clé API »** — ils portent un état côté serveur, les réutiliser signifie partager le contexte
- **Les appels de services internes doivent utiliser une authentification indépendante et sans état** pour éviter toute association avec les sessions utilisateur

## Références

- [Anthropic API Authentication Docs](https://docs.anthropic.com/en/api/getting-started)
- [Claude Code Authentication](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Anthropic Bans Subscription OAuth in Third-Party Apps](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Claude Code Authentication: API Keys, Subscriptions, and SSO](https://developertoolkit.ai/en/claude-code/quick-start/authentication/)
