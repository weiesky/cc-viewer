# ListMcpResources

Liste les ressources exposées par les serveurs MCP connectés, éventuellement filtrées sur un seul serveur.

## Quand l'utiliser

- Vous devez découvrir quelles ressources (fichiers, enregistrements, documents) un serveur MCP offre avant de les lire.
- Vous voulez un aperçu de toutes les ressources de chaque serveur connecté.

## Paramètres

- `server` (string, optionnel) : nom du serveur par lequel filtrer les ressources. Omettez pour lister les ressources de tous les serveurs connectés.

## Exemples

### Exemple 1 : tout lister

```
ListMcpResources()
```

### Exemple 2 : lister les ressources d'un seul serveur

```
ListMcpResources(server="github")
```

## Notes

- C'est l'étape de découverte : injectez les URI intéressants dans `ReadMcpResource` (ressource unique) ou `ReadMcpResourceDir` (listages de répertoires).
- Les serveurs se connectent et se déconnectent au cours de la vie de la session ; relistez si un serveur vient d'être ajouté.
