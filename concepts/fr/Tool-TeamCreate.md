# TeamCreate

## Définition

Crée une nouvelle équipe pour coordonner plusieurs agents travaillant sur un projet. Les équipes permettent l'exécution parallèle des tâches via une liste de tâches partagée et une messagerie inter-agents.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `team_name` | string | Oui | Nom de la nouvelle équipe |
| `description` | string | Non | Description / objectif de l'équipe |
| `agent_type` | string | Non | Type / rôle du responsable de l'équipe |

## Ce qui est créé

- **Fichier de configuration de l'équipe** : `~/.claude/teams/{team-name}/config.json` — stocke la liste des membres et les métadonnées
- **Répertoire de liste de tâches** : `~/.claude/tasks/{team-name}/` — liste de tâches partagée pour tous les coéquipiers

Les équipes ont une correspondance 1:1 avec les listes de tâches.

## Flux de travail de l'équipe

1. **TeamCreate** — créer l'équipe et sa liste de tâches
2. **TaskCreate** — définir les tâches pour l'équipe
3. **Agent** (avec `team_name` + `name`) — démarrer des coéquipiers qui rejoignent l'équipe
4. **TaskUpdate** — attribuer des tâches aux coéquipiers via `owner`
5. Les coéquipiers travaillent sur les tâches et communiquent via **SendMessage**
6. Arrêter les coéquipiers une fois terminé, puis **TeamDelete** pour nettoyer

## Outils associés

| Outil | Rôle |
|-------|------|
| `TeamDelete` | Supprimer l'équipe et les répertoires de tâches |
| `SendMessage` | Communication inter-agents au sein de l'équipe |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Gérer la liste de tâches partagée |
| `Agent` | Démarrer des coéquipiers qui rejoignent l'équipe |
