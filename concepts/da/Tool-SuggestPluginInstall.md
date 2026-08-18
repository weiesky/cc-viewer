# SuggestPluginInstall

Gengiver et inline plugin-installationskort fra `SearchPlugins`-resultater og knytter plugin-forslag til brugerens anmodning.

## Hvornår skal den bruges

- En pluginsøgning viste plugins, der matcher det, brugeren forsøger at gøre, og du vil tilbyde dem til installation.

## Parametre

- `contextLabel` (string, påkrævet): Kort overskrift, der knytter forslaget til brugeranmodningen (maks. 128 tegn).
- `plugins` (array, påkrævet): Plugins hentet fra `SearchPlugins`-resultater — 1-16 poster, hver med:
  - `pluginId` (string, påkrævet)
  - `pluginName` (string, påkrævet)
  - `description` (string, påkrævet)
  - `skills` (array, valgfri): Op til 32 `{name, description?}`-poster, der beskriver plugin'ets skills.

## Eksempler

### Eksempel 1: Tilbyd et matchende plugin

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

Kortet gengives for brugeren; aktivering af plugin'et sker uden for værktøjet. Kald `ListPlugins` ved opfølgning for at opdage, hvad der faktisk blev installeret.

## Noter

- Medtag kun plugins, der kom fra søgeresultater — opfind aldrig plugin-poster.
- Deaktiveret under HIPAA enterprise-konfigurationer.
