# ListAgents

Lister agentene du kan `SendMessage` til: in-process subagenter du startet, andre lokale Claude-sesjoner på denne maskinen, dine cloud-sesjoner (når denne sesjonen har cloud-tilgang) og — når Remote Control er tilkoblet — kontoens andre sesjoner. Hver rad er merket med type.

## Når skal den brukes

- Du trenger det eksakte navnet på en peer-sesjon eller subagent før du sender den en melding.
- Du vil se hvilke sesjoner som for øyeblikket er nåbare fra denne.

## Aktivering

- Krever Claude Code 2.1.224+ og kryss-sesjonsmeldinger (et server-side feature-flag, av som standard).
- Kryss-sesjonsmeldinger er utilgjengelige på Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform og Microsoft Foundry.
- Av når `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK` eller `DISABLE_GROWTHBOOK` er satt.
- Tving aktivering med `CLAUDE_CODE_HARBOR_KITE=1`.

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
