# MainAgent

## Définition

MainAgent est la chaîne de requêtes principale de Claude Code en état non agent team. Chaque interaction de l'utilisateur avec Claude Code produit une série de requêtes API, où les requêtes MainAgent constituent la chaîne de conversation centrale — elles portent le system prompt complet, les définitions d'outils et l'historique des messages.

## Méthode d'identification

Dans cc-viewer, MainAgent est identifié par `req.mainAgent === true`, marqué automatiquement par `interceptor.js` lors de la capture de la requête.

Conditions de détermination (toutes doivent être remplies) :
- Le corps de la requête contient le champ `system` (system prompt)
- Le corps de la requête contient le tableau `tools` (définitions d'outils)
- Le system prompt contient le texte caractéristique « Claude Code »

## Différences avec SubAgent

| Caractéristique | MainAgent | SubAgent |
|-----------------|-----------|----------|
| system prompt | Prompt principal complet de Claude Code | Prompt simplifié spécifique à la tâche |
| Tableau tools | Contient tous les outils disponibles | Ne contient généralement que les quelques outils nécessaires à la tâche |
| Historique des messages | Accumule le contexte complet de la conversation | Ne contient que les messages liés à la sous-tâche |
| Comportement de cache | A le prompt caching (TTL de 5 minutes) | Généralement sans cache ou avec un cache réduit |
