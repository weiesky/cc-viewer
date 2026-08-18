# EndConversation

Avslutter gjeldende samtale og hindrer at flere meldinger sendes.

## Når skal den brukes

- Kun ved vedvarende brukermisbruk, eller når brukeren eksplisitt ber om en demonstrasjon av dette verktøyet.

Dette er en siste-utvei-handling: verktøyets egne regler krever å advare brukeren først og bekrefte før bruk, og det må aldri brukes i selvskadings- eller skaderelaterte situasjoner.

## Aktivering

- Krever Claude Code 2.1.213+ og en modell fra Opus 4.8 / Sonnet 5 / Fable 5-familien eller nyere.
- Kun interaktive terminalsesjoner — aldri i `--bare`-modus, og aldri tilgjengelig for subagenter.
- Ikke tilgjengelig på Amazon Bedrock, Claude Platform on AWS, Vertex AI, Microsoft Foundry eller cloud-gateways.
- Krever et server-side feature-flag — de fleste sesjoner tilbyr ikke dette verktøyet.

## Parametere

Dette verktøyet tar ingen parametere.

## Eksempler

### Eksempel 1: Avslutt samtalen

```
EndConversation()
```

Flyten er totrinns: det første kallet returnerer en refleksjonsmelding; et andre kall umiddelbart etterpå avslutter faktisk samtalen (`ended: true`).

## Notater

- Sterkt gated: krever en støttet modell, CLI-inngangspunktet og et server-side feature-flag — de fleste sesjoner tilbyr ikke dette verktøyet.
- Når den er avsluttet, kan ingen flere meldinger sendes i samtalen.
