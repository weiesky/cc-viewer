# ListPlugins

Lister brukerens aktiverte claude.ai-plugins, eventuelt filtrert etter nøkkelord.

## Når skal den brukes

- Du må vite hvilke plugins som allerede er aktivert — for eksempel for å bekrefte hva som ble installert etter et `SuggestPluginInstall`-kort.
- Brukeren spør hvilke plugins de har.

## Aktivering

- Krever tilgangstillatelse til plugin-registeret.
- Tilgjengeligheten avhenger av sesjonstype og feature-utrulling — deaktivert i HIPAA-miljøer, alltid tilgjengelig i eksterne sesjoner.

## Parametere

- `keywords` (array av strenger, valgfri): Filtrer listen — opptil 8 elementer, hver 1–64 tegn. Utelat for å liste alt.

## Eksempler

### Eksempel 1: List aktiverte plugins

```
ListPlugins()
```

### Eksempel 2: Filtrer etter nøkkelord

```
ListPlugins(keywords=["figma"])
```

## Notater

- Hvis plugin-katalogen er utilgjengelig (forbudt), degraderer verktøyet til en tom liste med en advarsel i stedet for å feile.
