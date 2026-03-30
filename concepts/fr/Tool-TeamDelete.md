# TeamDelete

## Définition

Supprime une équipe et ses répertoires de tâches associés lorsque le travail de collaboration multi-agent est terminé. C'est le pendant de nettoyage de TeamCreate.

## Comportement

- Supprime le répertoire de l'équipe : `~/.claude/teams/{team-name}/`
- Supprime le répertoire de liste de tâches : `~/.claude/tasks/{team-name}/`
- Efface le contexte de l'équipe de la session courante

**Important** : TeamDelete échouera si l'équipe a encore des membres actifs. Les coéquipiers doivent d'abord être arrêtés proprement via des demandes d'arrêt SendMessage.

## Utilisation typique

TeamDelete est appelé en fin de flux de travail d'équipe :

1. Toutes les tâches sont terminées
2. Les coéquipiers sont arrêtés via `SendMessage` avec `shutdown_request`
3. **TeamDelete** supprime les répertoires de l'équipe et des tâches

## Outils associés

| Outil | Rôle |
|-------|------|
| `TeamCreate` | Créer une nouvelle équipe et sa liste de tâches |
| `SendMessage` | Communiquer avec les coéquipiers / envoyer des demandes d'arrêt |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gérer la liste de tâches partagée |
| `Agent` | Démarrer des coéquipiers qui rejoignent l'équipe |
