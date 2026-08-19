# SuggestPluginInstall

Affiche une carte d'installation de plugin en ligne à partir des résultats de `SearchPlugins`, en reliant les suggestions de plugins à la requête de l'utilisateur.

## Quand l'utiliser

- Une recherche de plugins a fait remonter des plugins qui correspondent à ce que l'utilisateur essaie de faire, et vous voulez les proposer à l'installation.

## Activation

- Uniquement lorsqu'un client Remote Control est connecté, ou lorsque la session s'exécute dans un environnement cloud géré.
- Désactivé sous les configurations d'entreprise HIPAA.
- Pas en mode brief.

## Paramètres

- `contextLabel` (string, requis) : en-tête court reliant la suggestion à la requête de l'utilisateur (max 128 caractères).
- `plugins` (array, requis) : plugins issus des résultats de `SearchPlugins` — 1 à 16 entrées, chacune avec :
  - `pluginId` (string, requis)
  - `pluginName` (string, requis)
  - `description` (string, requis)
  - `skills` (array, optionnel) : jusqu'à 32 entrées `{name, description?}` décrivant les skills du plugin.

## Exemples

### Exemple 1 : proposer un plugin correspondant

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

La carte est affichée pour l'utilisateur ; l'activation du plugin se fait hors bande. Appelez `ListPlugins` en suivi pour découvrir ce qui a réellement été installé.

## Notes

- N'incluez que les plugins issus des résultats de recherche — n'inventez jamais d'entrées de plugin.
