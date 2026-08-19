# EnterPlanMode

Fait basculer la session en mode plan, une phase d'exploration en lecture seule durant laquelle l'assistant étudie la base de code et rédige un plan d'implémentation concret que l'utilisateur devra approuver avant toute modification de fichier.

## Quand l'utiliser

- L'utilisateur demande un changement non trivial couvrant plusieurs fichiers ou sous-systèmes.
- Les exigences sont ambiguës et l'assistant doit lire le code avant de s'engager sur une approche.
- Un refactoring, une migration ou une mise à niveau de dépendance est proposé et le rayon d'impact n'est pas clair.
- L'utilisateur dit explicitement « plan this », « let's plan first », ou demande une revue de conception.
- Le risque est suffisamment élevé pour que passer directement aux modifications puisse gaspiller du travail ou endommager l'état.

## Paramètres

Aucun. `EnterPlanMode` ne prend aucun argument — invoquez-le avec un objet de paramètres vide.

## Exemples

### Exemple 1 : demande de fonctionnalité majeure

L'utilisateur demande : « Ajoute le SSO via Okta au panneau d'administration. » L'assistant appelle `EnterPlanMode`, puis passe plusieurs tours à lire le middleware d'authentification, le stockage de session, les gardes de routes et l'interface de connexion existante. Il rédige un plan décrivant les changements requis, les étapes de migration et la couverture de tests, puis soumet via `ExitPlanMode` pour approbation.

### Exemple 2 : refactoring risqué

L'utilisateur dit : « Convertis les contrôleurs REST en tRPC. » L'assistant entre en mode plan, passe en revue chaque contrôleur, catalogue le contrat public, liste les phases de déploiement (shim, double lecture, bascule) et propose un plan de séquencement avant de toucher à un fichier.

## Notes

- Le mode plan est en lecture seule par contrat. Tant qu'il est actif, l'assistant ne doit pas exécuter `Edit`, `Write`, `NotebookEdit` ni aucune commande shell mutative. Utilisez uniquement `Read`, `Grep`, `Glob` et des commandes `Bash` non destructives.
- N'entrez pas en mode plan pour des modifications triviales d'une seule ligne, des questions de pure recherche, ou des tâches où l'utilisateur a déjà spécifié entièrement le changement. Le surcoût nuit plus qu'il n'aide.
- En mode Auto, le mode plan est découragé sauf si l'utilisateur le demande explicitement — le mode Auto privilégie l'action à la planification préalable.
- Utilisez le mode plan pour réduire les corrections de trajectoire sur des travaux coûteux. Un plan de cinq minutes économise souvent une heure de modifications mal orientées.
- Une fois en mode plan, concentrez l'investigation sur les parties du système qui vont effectivement changer. Évitez les tours exhaustifs du dépôt sans rapport avec la tâche en cours.
- Le plan lui-même doit être écrit sur disque au chemin attendu par le harnais afin que `ExitPlanMode` puisse le soumettre. Le plan doit contenir des chemins de fichiers concrets, des noms de fonctions et des étapes de vérification, et non une intention vague.
- L'utilisateur peut rejeter le plan et demander des révisions. Itérez en mode plan jusqu'à ce que le plan soit accepté ; ne sortez qu'à ce moment-là.
