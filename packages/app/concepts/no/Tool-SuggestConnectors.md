# SuggestConnectors

Løser opp fullstendige connector-nyttelaster for `directoryUuid`-verdier returnert av `SearchMcpRegistry`, slik at brukeren kan tilbys konkrete connectorer å aktivere.

## Når skal den brukes

- Etter at `SearchMcpRegistry` returnerer kandidat-connectorer, for å hente fullstendige detaljer for presentasjon.

## Aktivering

- Kun tilgjengelig i eksterne (claude.ai) sesjoner på førsteparts-API-et.

## Parametere

- `uuids` (array av strenger, påkrevd): `directoryUuid`- eller `server_id`-verdier som skal løses opp. 1–32 elementer, hver 1–64 tegn.

## Eksempler

### Eksempel 1: Løs opp to registertreff

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Notater

- Gjett aldri UUID-er — løs kun opp identifikatorer som kom tilbake fra `SearchMcpRegistry`.
- Verktøyet kobler ingenting til selv; aktivering av en connector skjer utenfor verktøyet.
