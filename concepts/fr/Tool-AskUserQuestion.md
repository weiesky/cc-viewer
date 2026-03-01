# AskUserQuestion

## Définition

Pose des questions à l'utilisateur pendant l'exécution pour obtenir des clarifications, vérifier des hypothèses ou demander des décisions.

## Paramètres

| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `questions` | array | Oui | Liste de questions (1-4 questions) |
| `answers` | object | Non | Réponses collectées auprès de l'utilisateur |
| `annotations` | object | Non | Annotations pour chaque question (comme les notes de prévisualisation de sélection) |
| `metadata` | object | Non | Métadonnées pour le suivi et l'analyse |

Chaque objet `question` :

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `question` | string | Oui | Texte complet de la question, doit se terminer par un point d'interrogation |
| `header` | string | Oui | Étiquette courte (maximum 12 caractères), affichée comme chip d'étiquette |
| `options` | array | Oui | 2-4 options |
| `multiSelect` | boolean | Oui | Si la sélection multiple est autorisée |

Chaque objet `option` :

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `label` | string | Oui | Texte d'affichage de l'option (1-5 mots) |
| `description` | string | Oui | Description de l'option |
| `markdown` | string | Non | Contenu de prévisualisation (pour la comparaison visuelle de mises en page ASCII, extraits de code, etc.) |

## Cas d'utilisation

**Adapté pour :**
- Collecter les préférences ou exigences de l'utilisateur
- Clarifier des instructions ambiguës
- Obtenir des décisions pendant l'implémentation
- Offrir des choix de direction à l'utilisateur

**Non adapté pour :**
- Demander « le plan est-il correct ? » — utiliser ExitPlanMode

## Notes

- L'utilisateur peut toujours sélectionner « Other » pour fournir une entrée personnalisée
- L'option recommandée est placée en premier, avec « (Recommended) » à la fin du label
- La prévisualisation `markdown` n'est compatible qu'avec les questions à sélection unique
- Les options avec `markdown` passent à une disposition côte à côte
- En mode planification, utilisé pour clarifier les exigences avant de définir le plan

## Signification dans cc-viewer

Les appels à AskUserQuestion apparaissent dans le journal des requêtes comme des content blocks `tool_use`, contenant les définitions de questions et d'options. Les réponses de l'utilisateur apparaissent dans l'historique des messages des requêtes suivantes.

## Texte original

<textarea readonly>Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.

Preview feature:
Use the optional `markdown` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

When any option has a markdown, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
</textarea>
