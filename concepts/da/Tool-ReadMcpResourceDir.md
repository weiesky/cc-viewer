# ReadMcpResourceDir

Lister posterne i en mappeagtig resource, der eksponeres af en forbundet MCP-server, adresseret ved dens URI.

## Hvornår skal den bruges

- En MCP-server organiserer ressourcer hierarkisk, og du har brug for at optælle ét niveau af det hierarki.
- Du vil browse, før du læser individuelle ressourcer med `ReadMcpResource`.

## Parametre

- `server` (string, påkrævet): MCP-serverens navn.
- `uri` (string, påkrævet): Mapperesource-URI'en, der skal listes.

## Eksempler

### Eksempel 1: List et resource-mappeindhold

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Returnerer de underposter, serveren eksponerer under den mappe-URI.

## Noter

- Kun servere, der modellerer deres ressourcer som mapper, understøtter dette; flade servere returnerer en fejl eller en tom liste — fald tilbage til `ListMcpResources`.
- Kombinér med `ReadMcpResource` for at bore ned i de poster, der ser relevante ud.
