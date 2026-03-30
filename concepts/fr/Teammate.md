# Teammate

## Definition

Un Teammate est un agent collaboratif dans le mode equipe de Claude Code Agent. Lorsque l'agent principal cree une equipe via `TeamCreate` et genere des teammates a l'aide de l'outil `Agent`, chaque teammate s'execute en tant que processus d'agent independant avec sa propre fenetre de contexte et son propre ensemble d'outils, communiquant avec les membres de l'equipe via `SendMessage`.

## Differences avec SubAgent

| Caracteristique | Teammate | SubAgent |
|-----------------|----------|----------|
| Cycle de vie | Persistant, peut recevoir plusieurs messages | Tache unique, detruit a la fin |
| Communication | Messagerie bidirectionnelle avec SendMessage | Appel unidirectionnel parent→enfant, retourne le resultat |
| Contexte | Contexte complet independant, conserve entre les tours | Contexte de tache isole |
| Collaboration | Collaboration en equipe, peuvent communiquer entre eux | Structure hierarchique, interagit uniquement avec l'agent parent |
| Type de tache | Taches complexes en plusieurs etapes | Taches individuelles comme la recherche et l'exploration |

## Comportement

- Cree par l'agent principal (team lead) via l'outil `Agent` et assigne a un `team_name`
- Partage les listes de taches via `TaskList` / `TaskGet` / `TaskUpdate`
- Entre en etat idle apres chaque tour, en attente d'etre reveille par un nouveau message
- Peut etre termine de maniere elegante via `shutdown_request`

## Description du panneau de statistiques

Le panneau de statistiques Teammate affiche le nombre d'appels API pour chaque teammate. La colonne `Name` indique le nom du teammate (par exemple, `reviewer-security`, `reviewer-pipeline`), et la colonne `Count` indique le nombre total de requetes API generees par ce teammate.
