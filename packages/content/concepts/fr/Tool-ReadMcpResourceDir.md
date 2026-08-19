# ReadMcpResourceDir

Liste les entrées d'une ressource de type répertoire exposée par un serveur MCP connecté, adressée par son URI.

## Quand l'utiliser

- Un serveur MCP organise ses ressources de façon hiérarchique et vous devez énumérer un niveau de cette hiérarchie.
- Vous voulez parcourir avant de lire des ressources individuelles avec `ReadMcpResource`.

## Activation

- Toujours activé, mais non exposé à la liste d'outils du modèle — destiné à une utilisation thin-client / sidecar.

## Paramètres

- `server` (string, requis) : le nom du serveur MCP.
- `uri` (string, requis) : l'URI de la ressource répertoire à lister.

## Exemples

### Exemple 1 : lister un répertoire de ressources

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Renvoie les entrées enfants que le serveur expose sous cet URI de répertoire.

## Notes

- Seuls les serveurs qui modélisent leurs ressources comme des répertoires prennent cela en charge ; les serveurs plats renverront une erreur ou un listage vide — repliez-vous sur `ListMcpResources`.
- Combinez avec `ReadMcpResource` pour descendre dans les entrées qui semblent pertinentes.
