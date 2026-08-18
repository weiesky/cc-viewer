# SendFeedback

Envoie des retours structurés sur Claude Code à Anthropic — rapports de bug, idées de fonctionnalités ou capacités manquantes — sans quitter la session.

## Quand l'utiliser

- L'utilisateur demande de signaler un bug ou d'envoyer des retours sur Claude Code lui-même.
- Vous rencontrez un défaut produit manifeste (commande cassée, comportement erroné, plantage) qui mérite d'être signalé.
- L'utilisateur décrit une fonctionnalité qu'il aimerait voir exister (une idée ou une capacité manquante).

## Paramètres

- `type` (string, requis) : l'une des valeurs `bug`, `idea`, `missing_capability`.
- `title` (string, requis) : résumé court et précis du problème en une ligne.
- `details` (string, requis) : puces libellées, dans l'ordre : **What happened:** (observé vs attendu, texte d'erreur exact s'il est court) ; **What the user said:** (cité, ou "User didn't comment; observed by the model.") ; **Repro:** (étapes minimales) ; **Evidence:** (IDs de requête, horodatages, chemins, versions — omettez s'il n'y en a pas) ; éventuellement un **Cause:** final uniquement s'il est vérifié en session. Une à trois lignes par puce ; pas de paragraphes narratifs, pas de spéculation, pas de secrets.
- `area` (string, optionnel) : étiquette courte nommant la partie de Claude Code concernée (p. ex. "hooks config", "/help", "file editing"). Laissez vide si ce n'est pas clair.
- `failure_mode` (string, optionnel) : pour les rapports de comportement du modèle, le mode d'échec le plus proche (p. ex. `instruction_following`, `repetition_and_looping`, `context_and_memory`, `stopping_short` ou `other`). Omettez uniquement lorsque le rapport est un pur bug produit/outil.
- `task_category` (string, optionnel) : ce que la session faisait lorsque le problème est survenu : `code_edit`, `debug`, `explain`, `plan`, `shell`, `search`, `review` ou `other`.

## Exemples

### Exemple 1 : signaler un bug produit

```
SendFeedback(
  type="bug",
  title="/export truncates the last message",
  details="**What happened:** exported transcript is missing the final assistant message.\n**What the user said:** \"the last reply never shows up in the file\".\n**Repro:** run /export after any multi-turn session.\n**Evidence:** v2.1.233, macOS.",
  area="/export",
  task_category="other"
)
```

## Notes

- N'incluez jamais de secrets, de jetons ou de données utilisateur privées dans `details`.
- Citez les mots de l'utilisateur lorsqu'ils sont disponibles ; sinon indiquez que le modèle a observé le problème.
- Gardez le rapport factuel — la spéculation sur la cause profonde appartient à `**Cause:**` uniquement lorsqu'elle est vérifiée en session.
