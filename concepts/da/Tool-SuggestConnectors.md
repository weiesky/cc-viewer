# SuggestConnectors

Opløser fulde connector-nyttelaster for `directoryUuid`-værdier returneret af `SearchMcpRegistry`, så brugeren kan tilbydes konkrete connectors at aktivere.

## Hvornår skal den bruges

- Efter at `SearchMcpRegistry` returnerer kandidat-connectors, for at hente deres fulde detaljer til præsentation.

## Parametre

- `uuids` (array af strings, påkrævet): `directoryUuid`- eller `server_id`-værdier at opløse. 1-32 elementer, hver 1-64 tegn.

## Eksempler

### Eksempel 1: Opløs to registerhits

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Noter

- Gæt aldrig UUID'er — opløs kun identifikatorer, der kom tilbage fra `SearchMcpRegistry`.
- Værktøjet forbinder intet selv; aktivering af en connector sker uden for værktøjet.
- Kun tilgængelig i remote-sessioner (claude.ai) på first-party-API'et.
