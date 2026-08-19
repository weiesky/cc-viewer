# SuggestConnectors

Résout les charges utiles complètes des connecteurs pour les valeurs `directoryUuid` renvoyées par `SearchMcpRegistry`, afin que l'utilisateur puisse se voir proposer des connecteurs concrets à activer.

## Quand l'utiliser

- Après que `SearchMcpRegistry` renvoie des connecteurs candidats, pour récupérer leurs détails complets en vue de leur présentation.

## Activation

- Disponible uniquement dans les sessions distantes (claude.ai) sur l'API first-party.

## Paramètres

- `uuids` (array de strings, requis) : valeurs `directoryUuid` ou `server_id` à résoudre. 1 à 32 éléments, 1 à 64 caractères chacun.

## Exemples

### Exemple 1 : résoudre deux résultats du registre

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Notes

- Ne devinez jamais les UUID — ne résolvez que les identifiants renvoyés par `SearchMcpRegistry`.
- L'outil ne connecte rien lui-même ; l'activation d'un connecteur se fait hors bande.
