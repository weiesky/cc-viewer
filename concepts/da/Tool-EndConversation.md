# EndConversation

Afslutter den aktuelle samtale og forhindrer, at yderligere beskeder sendes.

## Hvornår skal den bruges

- Kun ved vedvarende misbrug fra brugerens side, eller når brugeren eksplicit beder om en demonstration af dette værktøj.

Dette er en sidste-udvej-handling: værktøjets egne regler kræver, at man advarer brugeren først og bekræfter før brug, og det må aldrig bruges i selvskade- eller skadesrelaterede situationer.

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
