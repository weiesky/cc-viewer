# Projects

Gère les documents de projet dans la base de connaissances du projet Claude de l'utilisateur : lire, rechercher, écrire et supprimer des documents, ou récupérer les informations du projet.

## Quand l'utiliser

- Persister un document (livrable, notes, matériel de référence) dans le projet de l'utilisateur afin qu'il survive à la session.
- Lire ou rechercher des documents de projet existants pour ancrer la tâche courante dans un contexte antérieur.
- Téléverser un fichier local dans le projet sans charger son contenu dans le contexte.
- Supprimer un document de projet obsolète.

## Paramètres

- `method` (string, requis) : l'une des valeurs `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, optionnel) : pour `project_read`/`project_write`/`project_delete` : le chemin du document. Pour `project_write` : un chemin existant est remplacé sur place ; un nouveau nom de fichier nu (sans "/") est placé sous l'espace de noms `claude/<name>`.
- `content` (string, optionnel) : pour `project_write` : texte du document en ligne. Mutuellement exclusif avec `local_path`.
- `local_path` (string, optionnel) : pour `project_write` : un fichier situé dans le répertoire de travail à téléverser — son contenu n'entre jamais dans votre contexte. Mutuellement exclusif avec `content`.
- `present_to_user` (boolean, optionnel) : pour `project_write` : marque ce document comme le livrable que l'utilisateur doit voir. Défaut false ; laissez non défini pour les sauvegardes de routine et les écritures en masse.
- `query` (string, optionnel) : pour `project_search` : requête sur la base de connaissances.
- `n` (number, optionnel) : pour `project_search` : nombre de résultats (défaut 5).

## Exemples

### Exemple 1 : écrire le livrable dans le projet

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Téléverse le fichier local sans faire entrer son contenu dans le contexte, et le signale comme le livrable de l'utilisateur.

### Exemple 2 : rechercher dans la base de connaissances

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Notes

- `content` est destiné au texte que vous composez en ligne ; `local_path` à tout ce qui est déjà sur le disque — ne mélangez jamais les deux.
- Utilisez `present_to_user=true` avec parcimonie : uniquement pour le document que l'utilisateur a demandé ou sur lequel il doit agir.
