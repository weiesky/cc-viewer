# ReportFindings

Signalez les résultats de la révision du code sous forme d'une liste typée et structurée que l'interface utilisateur hôte restitue nativement — au lieu de les imprimer en tant que texte de chat.

## Quand l'utiliser

- Conclure une révision de code dont les instructions actives disent explicitement de signaler les résultats avec cet outil
- Re-signaler après application de correctifs, quand les instructions de révision le demandent (chaque résultat porte alors un `outcome`)
- **Pas** pour les opinions ad hoc, les réponses ordinaires ou les révisions dont les instructions spécifient un format de sortie différent — et jamais aux côtés d'une copie textuelle dupliquée des mêmes résultats

## Paramètres

- `findings` (tableau, requis, max 32) : Les résultats vérifiés, classés par sévérité d'abord — un tableau vide si aucun résultat n'a survécu à la vérification. Chaque résultat :
  - `file` (chaîne, requise) : Chemin relatif au référentiel.
  - `line` (nombre, optionnel) : Numéro de ligne d'ancrage indexé en 1.
  - `summary` (chaîne, requise) : Énoncé du défaut en une phrase.
  - `failure_scenario` (chaîne, requise) : Entrées/état concrets → sortie incorrecte ou crash.
  - `category` (chaîne, optionnel) : Courte limace en kebab-case, p. ex. `correctness`, `simplification`, `efficiency`, `test-coverage`.
  - `verdict` (chaîne, optionnel) : `CONFIRMED` ou `PLAUSIBLE` — défini quand une passe de vérification s'est exécutée ; absent pour les révisions en ligne uniquement.
  - `outcome` (chaîne, optionnel) : UNIQUEMENT lors de la re-signalisation après correctifs — `fixed`, `skipped` ou `no_change_needed`.
- `level` (chaîne, optionnel) : Le niveau d'effort auquel la révision s'est exécutée — `low`, `medium`, `high`, `xhigh` ou `max`.

## Notes

- **Appelez-le une fois.** Un seul appel avec la liste complète, vérifiée et triée par sévérité — pas un appel par résultat.
- **Vide est un résultat valide.** Si aucun résultat n'a survécu à la vérification, signalez un tableau vide plutôt que de remplir avec des résultats faibles.
- **Ne pas dupliquer en texte.** Quand cet outil signale les résultats, les résultats ne doivent pas être imprimés aussi sous forme d'un message de chat.
- **`outcome` est pour les re-signalations uniquement.** Au premier rapport, laissez-le désactivé ; après une passe d'application, définissez ce qui s'est réellement passé pour chaque résultat.
