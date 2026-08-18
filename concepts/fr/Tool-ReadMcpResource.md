# ReadMcpResource

Lit une seule ressource exposée par un serveur MCP (Model Context Protocol) connecté, adressée par son URI.

## Quand l'utiliser

- Un serveur MCP annonce une ressource (fichier, enregistrement, document) dont vous avez besoin du contenu dans le contexte.
- Vous disposez d'un URI de ressource concret — provenant de `ListMcpResources`, de la documentation du serveur ou d'un résultat d'outil précédent.

## Activation

- Toujours activé, mais non exposé à la liste d'outils du modèle — destiné à une utilisation thin-client / sidecar.

## Paramètres

- `server` (string, requis) : le nom du serveur MCP.
- `uri` (string, requis) : l'URI de la ressource à lire.

## Exemples

### Exemple 1 : lire une ressource de serveur par URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Renvoie le contenu de la ressource tel que fourni par le serveur MCP `github`.

## Notes

- Utilisez d'abord `ListMcpResources` si vous ne savez pas quelles ressources un serveur expose ; utilisez `ReadMcpResourceDir` pour les listages de type répertoire.
- Le schéma d'URI est spécifique au serveur (`file://`, `https://`, schémas personnalisés) — vérifiez ce que le serveur cible annonce.
