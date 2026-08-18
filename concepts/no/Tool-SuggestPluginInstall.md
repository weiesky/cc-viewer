# SuggestPluginInstall

Gjengir et innebygd plugin-installasjonskort fra `SearchPlugins`-resultater, og knytter plugin-forslag til brukerens forespørsel.

## Når skal den brukes

- Et plugin-søk fant frem plugins som matcher det brukeren prøver å gjøre, og du vil tilby dem for installasjon.

## Aktivering

- Kun når en Remote Control-klient er tilkoblet, eller sesjonen kjører i et administrert cloud-miljø.
- Deaktivert under HIPAA enterprise-konfigurasjoner.
- Ikke i brief-modus.

## Parametere

- `contextLabel` (string, påkrevd): Kort overskrift som knytter forslaget til brukerforespørselen (maks 128 tegn).
- `plugins` (array, påkrevd): Plugins hentet fra `SearchPlugins`-resultater — 1–16 oppføringer, hver med:
  - `pluginId` (string, påkrevd)
  - `pluginName` (string, påkrevd)
  - `description` (string, påkrevd)
  - `skills` (array, valgfri): Opptil 32 `{name, description?}`-oppføringer som beskriver pluginens skills.

## Eksempler

### Eksempel 1: Tilby en matchende plugin

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

Kortet gjengis for brukeren; aktivering av pluginen skjer utenfor verktøyet. Kall `ListPlugins` ved oppfølging for å oppdage hva som faktisk ble installert.

## Notater

- Inkluder kun plugins som kom fra søkeresultatene — finn aldri opp plugin-oppføringer.
