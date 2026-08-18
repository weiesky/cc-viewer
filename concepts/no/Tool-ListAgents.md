# ListAgents

Lister agentene du kan `SendMessage` til: in-process subagenter du startet, andre lokale Claude-sesjoner på denne maskinen, dine cloud-sesjoner (når denne sesjonen har cloud-tilgang) og — når Remote Control er tilkoblet — kontoens andre sesjoner. Hver rad er merket med type.

## Når skal den brukes

- Du trenger det eksakte navnet på en peer-sesjon eller subagent før du sender den en melding.
- Du vil se hvilke sesjoner som for øyeblikket er nåbare fra denne.

## Parametere

- `channel` (string, valgfri): Ikke tilgjengelig i dette bygget; la stå usatt.
- `q` (string, valgfri): Ikke tilgjengelig i dette bygget; la stå usatt.

## Eksempler

### Eksempel 1: Liste nåbare agenter

```
ListAgents()
```

Hver rad skriver ut et navn — det navnet er adressen. Send med `SendMessage({to: "<name>", message: "..."})`, ved å kopiere navnet nøyaktig som skrevet ut. Legg til en rads ` [ref]` kun når det nakne navnet er flertydig (to rader deler det, eller en feil ber deg om å disambiguere).

## Notater

- Skrivebeskyttet og samtidighetssikker.
- En cloud-sesjon mottar meldingen din, men kan ennå ikke melde tilbake — les svaret i dens egen transkripsjon.
- Tilgjengelighet avhenger av sesjonskonfigurasjonen (kryss-sesjonsmeldinger er en gated funksjon).
