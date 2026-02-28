# Agent

## Définition

Lance un sous-agent (SubAgent) pour gérer de manière autonome des tâches complexes multi-étapes. Les sous-agents sont des sous-processus indépendants, chacun avec son propre ensemble d'outils et contexte dédiés. Agent est la version renommée de l'outil Task dans les nouvelles versions de Claude Code.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `prompt` | string | Oui | Description de la tâche à exécuter par le sous-agent |
| `description` | string | Oui | Résumé bref de 3-5 mots |
| `subagent_type` | string | Oui | Type de sous-agent, détermine l'ensemble d'outils disponibles |
| `model` | enum | Non | Spécifier le modèle (sonnet / opus / haiku), par défaut hérité du parent |
| `max_turns` | integer | Non | Nombre maximum de tours agentiques |
| `run_in_background` | boolean | Non | Si la tâche s'exécute en arrière-plan ; les tâches en arrière-plan renvoient le chemin du output_file |
| `resume` | string | Non | ID de l'agent à reprendre, continue depuis la dernière exécution. Utile pour reprendre un sous-agent précédent sans perdre le contexte |
| `isolation` | enum | Non | Mode d'isolation, `worktree` crée un git worktree temporaire |

## Types de sous-agents

| Type | Utilité | Outils disponibles |
|------|---------|-------------------|
| `Bash` | Exécution de commandes, opérations git | Bash |
| `general-purpose` | Tâches générales multi-étapes | Tous les outils |
| `Explore` | Exploration rapide de la base de code | Tous les outils sauf Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `Plan` | Concevoir des plans d'implémentation | Tous les outils sauf Agent/Edit/Write/NotebookEdit/ExitPlanMode |
| `claude-code-guide` | Questions-réponses sur le guide d'utilisation de Claude Code | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configurer la barre d'état | Read, Edit |

## Cas d'utilisation

**Adapté pour :**
- Tâches complexes nécessitant une réalisation autonome en plusieurs étapes
- Exploration de la base de code et recherche approfondie (utiliser le type Explore)
- Travail parallèle nécessitant des environnements isolés
- Tâches de longue durée nécessitant une exécution en arrière-plan

**Non adapté pour :**
- Lire des chemins de fichiers spécifiques — utiliser directement Read ou Glob
- Rechercher dans 2-3 fichiers connus — utiliser directement Read
- Rechercher des définitions de classes spécifiques — utiliser directement Glob

## Notes

- Le sous-agent renvoie un seul message à la fin, ses résultats ne sont pas visibles pour l'utilisateur et l'agent principal doit les transmettre
- Plusieurs appels Agent peuvent être lancés en parallèle dans un seul message pour améliorer l'efficacité
- Les tâches en arrière-plan vérifient la progression via l'outil TaskOutput
- Le type Explore est plus lent que l'appel direct à Glob/Grep, à utiliser uniquement quand la recherche simple ne suffit pas
- Utilisez `run_in_background: true` pour les tâches longues ne nécessitant pas de résultat immédiat ; utilisez le mode premier plan (par défaut) quand le résultat est nécessaire avant de continuer
- Le paramètre `resume` permet de continuer une session de sous-agent précédemment démarrée, en préservant le contexte accumulé

## Signification dans cc-viewer

Agent est le nouveau nom de l'outil Task dans les versions récentes de Claude Code. Les appels Agent produisent des chaînes de requêtes SubAgent, visibles dans la liste des requêtes comme des séquences de sous-requêtes indépendantes du MainAgent. Les requêtes SubAgent ont généralement un system prompt simplifié et moins de définitions d'outils, formant un contraste net avec le MainAgent. Dans cc-viewer, les noms d'outils `Task` ou `Agent` peuvent apparaître selon la version de Claude Code utilisée dans la conversation enregistrée.
