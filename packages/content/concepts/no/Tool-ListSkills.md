# ListSkills

Lister brukerens aktiverte claude.ai-skills, eventuelt filtrert etter nøkkelord.

## Når skal den brukes

- Du trenger den autoritative listen over skills som for øyeblikket er aktivert — før du påkaller en, eller for å bekrefte hva et `SuggestSkills`-kort la til.
- Brukeren spør hvilke skills de har.

## Aktivering

- Krever tilgangstillatelse til plugin-registeret.
- Deaktivert i HIPAA-miljøer.
- Alltid tilgjengelig i eksterne sesjoner.

## Parametere

- `keywords` (array av strenger, valgfri): Filtrer listen — opptil 8 elementer, hver 1–64 tegn. Utelat for å liste alt.

## Eksempler

### Eksempel 1: List aktiverte skills

```
ListSkills()
```

### Eksempel 2: Filtrer etter nøkkelord

```
ListSkills(keywords=["review"])
```

## Notater

- Hvis katalogen er utilgjengelig (forbudt), degraderer verktøyet til en tom liste med en advarsel i stedet for å feile.
- Dette lister *aktiverte* skills; bruk `SuggestSkills` for å vise frem skills brukeren kunne legge til.
