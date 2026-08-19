# Workflow

Exécute un script qui orchestre de nombreux sous-agents de manière déterministe — diffusion en éventail, pipelines, boucles et vérification — pour un travail trop vaste, trop incertain ou trop volumineux pour un seul contexte.

## Quand l'utiliser

- Décomposer une tâche volumineuse et la couvrir en parallèle sur de nombreux agents
- Recouper les résultats par une vérification indépendante ou contradictoire avant de s'y fier
- Prendre en charge une échelle qu'un seul contexte ne peut contenir : migrations, audits, balayages étendus sur plusieurs fichiers

## Fonctionnement

- S'exécute en arrière-plan ; vous êtes notifié à la fin. Suivez la progression en direct avec `/workflows`.
- Le script coordonne les agents avec `agent()`, `parallel()`, `pipeline()` et `phase()`.
- `pipeline()` fait transiter chaque élément à travers les étapes sans barrière (par défaut) ; `parallel()` est une barrière qui attend tous les résultats.
- Avec un `schema`, chaque `agent()` renvoie des données structurées validées plutôt qu'un texte libre.

## Notes

- Ne s'exécute que lorsque l'utilisateur opte explicitement pour une orchestration multi-agents ; il peut générer de nombreux agents et consommer une quantité importante de token.
- La concurrence est plafonnée par workflow ; les agents excédentaires sont mis en file d'attente et s'exécutent à mesure que des emplacements se libèrent.
- Pour un seul sous-agent, utilisez plutôt l'outil `Agent` — réservez Workflow à une véritable diffusion en éventail.

## Concepts associés

- S'appuie sur l'outil `Agent`, en exécutant de nombreux agents sous un flux de contrôle déterministe.
