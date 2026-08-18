# ListPlugins

Lister brugerens aktiverede claude.ai-plugins, eventuelt filtreret efter nøgleord.

## Hvornår skal den bruges

- Du har brug for at vide, hvilke plugins der allerede er aktiveret — for eksempel for at bekræfte, hvad der blev installeret efter et `SuggestPluginInstall`-kort.
- Brugeren spørger, hvilke plugins de har.

## Aktivering

- Kræver tilladelse til adgang til plugin-registret.
- Tilgængelighed afhænger af sessionstype og feature-udrulning — deaktiveret i HIPAA-miljøer, altid tilgængelig i remote-sessioner.

## Parametre

- `keywords` (array af strings, valgfri): Filtrer listen — op til 8 elementer, hver 1-64 tegn. Udelad for at liste alt.

## Eksempler

### Eksempel 1: List aktiverede plugins

```
ListPlugins()
```

### Eksempel 2: Filtrer efter nøgleord

```
ListPlugins(keywords=["figma"])
```

## Noter

- Hvis plugin-kataloget er uopnåeligt (forbudt), nedgraderer værktøjet til en tom liste med en advarsel i stedet for at fejle.
