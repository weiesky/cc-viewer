# Body Diff JSON (Comparaison incrémentale du corps de la requête)

## Contexte

Le MainAgent de Claude Code utilise un mécanisme d'envoi de contexte complet — chaque requête inclut l'historique complet de la conversation, le system prompt, les définitions d'outils, etc. Cela signifie qu'au fur et à mesure que la conversation progresse, le corps de la requête devient de plus en plus volumineux, et il est difficile d'identifier rapidement « ce qui a été ajouté dans ce tour » en regardant le Body brut.

Body Diff JSON résout exactement ce problème : il compare automatiquement les corps de deux requêtes MainAgent consécutives, extrait la partie incrémentale et vous permet de voir d'un coup d'œil le contenu réellement nouveau dans cette requête.

## Fonctionnement

1. **Identifier les requêtes MainAgent consécutives** : La requête actuelle doit être de type MainAgent et une requête MainAgent précédente doit exister
2. **Comparaison champ par champ** : Parcourt tous les champs de niveau supérieur du corps de la requête, en ignorant les propriétés internes préfixées par `_`
3. **Extraction intelligente des différences** :
   - Champs ajoutés : Affichés directement
   - Champs supprimés : Non affichés (n'affectent généralement pas la compréhension)
   - Champs modifiés : La valeur actuelle est affichée
   - Traitement spécial du tableau `messages` : Seuls les nouveaux messages sont affichés (car en conversation normale, le mode est l'ajout, les messages précédents ne changent pas)
4. **Détection de réduction du corps** : Si le corps actuel est plus petit que le précédent, cela indique une troncature de contexte ou une réinitialisation de session, et un message informatif est affiché au lieu du diff

## Scénarios typiques

Dans un tour de conversation normal, le Body Diff JSON ne contient généralement que :
- `messages` : 1~2 nouveaux messages (l'entrée de l'utilisateur + la réponse de l'assistant du tour précédent)

Si vous voyez des changements dans `system`, `tools`, `model` ou d'autres champs dans le diff, cela signifie qu'un changement de configuration a eu lieu dans ce tour, ce qui est souvent aussi la cause de la reconstruction du cache.

## Utilisation

- Le Body Diff JSON est affiché dans le panneau de détails de la requête MainAgent
- Cliquez sur le titre pour développer/réduire
- Prend en charge deux modes de visualisation : JSON et Text, ainsi que la copie en un clic
- Dans **CC-Viewer → Paramètres globaux** (coin supérieur gauche), vous pouvez configurer « Développer le Body Diff JSON par défaut »
