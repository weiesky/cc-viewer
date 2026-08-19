# ListAgents

Lister de agenter, du kan `SendMessage` til: in-process-subagenter, du har startet, andre lokale Claude-sessioner på denne maskine, dine cloud-sessioner (når denne session har cloud-adgang) og — når Remote Control er forbundet — din kontos andre sessioner. Hver række er mærket efter art.

## Hvornår skal den bruges

- Du har brug for det eksakte navn på en peer-session eller sub-agent, før du sender den en besked.
- Du vil se, hvilke sessioner der i øjeblikket kan nås fra denne.

## Aktivering

- Kræver Claude Code 2.1.224+ og beskeder på tværs af sessioner (et server-side feature-flag, slået fra som standard).
- Beskeder på tværs af sessioner er ikke tilgængelige på Amazon Bedrock, Claude Platform on AWS, Google Cloud Agent Platform og Microsoft Foundry.
- Slået fra, når `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK` eller `DISABLE_GROWTHBOOK` er sat.
- Tving aktivering med `CLAUDE_CODE_HARBOR_KITE=1`.

## Parametre

- `channel` (string, valgfri): Ikke tilgængelig i dette build; lad være usat.
- `q` (string, valgfri): Ikke tilgængelig i dette build; lad være usat.

## Eksempler

### Eksempel 1: List tilgængelige agenter

```
ListAgents()
```

Hver række udskriver et navn — det navn er adressen. Send med `SendMessage({to: "<name>", message: "..."})`, og kopiér navnet nøjagtigt som udskrevet. Tilføj en rækkes ` [ref]` kun, når det bare navn er tvetydigt (to rækker deler det, eller en fejl beder dig disambiguere).

## Noter

- Skrivebeskyttet og samtidighedssikker.
- En cloud-session modtager din besked, men kan endnu ikke svare tilbage — læs dens svar i dens egen transskript.
