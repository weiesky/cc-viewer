# EndConversation

Afslutter den aktuelle samtale og forhindrer, at yderligere beskeder sendes.

## Hvornår skal den bruges

- Kun ved vedvarende misbrug fra brugerens side, eller når brugeren eksplicit beder om en demonstration af dette værktøj.

Dette er en sidste-udvej-handling: værktøjets egne regler kræver, at man advarer brugeren først og bekræfter før brug, og det må aldrig bruges i selvskade- eller skadesrelaterede situationer.

## Aktivering

- Kræver Claude Code 2.1.213+ og en model fra Opus 4.8 / Sonnet 5 / Fable 5 eller nyere familie.
- Kun interaktive terminalsessioner — aldrig i `--bare`-tilstand og aldrig tilgængelig for underagenter.
- Ikke tilgængelig på Amazon Bedrock, Claude Platform on AWS, Vertex AI, Microsoft Foundry eller cloud-gateways.
- Kræver et server-side feature-flag — de fleste sessioner tilbyder ikke dette værktøj.

## Parametre

Dette værktøj tager ingen parametre.

## Eksempler

### Eksempel 1: Afslut samtalen

```
EndConversation()
```

Forløbet er to-trins: det første kald returnerer en refleksionsbesked; et andet kald umiddelbart efter afslutter faktisk samtalen (`ended: true`).

## Noter

- Kraftigt gated: kræver en understøttet model, CLI-indgangspunktet og et server-side feature-flag — de fleste sessioner tilbyder ikke dette værktøj.
- Når den er afsluttet, kan der ikke sendes flere beskeder i samtalen.
