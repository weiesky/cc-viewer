# ReadMcpResource

Læser en enkelt resource, der eksponeres af en forbundet MCP-server (Model Context Protocol), adresseret ved dens URI.

## Hvornår skal den bruges

- En MCP-server annoncerer en resource (fil, post, dokument), hvis indhold du har brug for i kontekst.
- Du har en konkret resource-URI — fra `ListMcpResources`, fra serverens dokumentation eller fra et tidligere værktøjsresultat.

## Parametre

- `server` (string, påkrævet): MCP-serverens navn.
- `uri` (string, påkrævet): Resource-URI'en, der skal læses.

## Eksempler

### Eksempel 1: Læs en server-resource ved URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Returnerer resource-indholdet, som leveret af `github`-MCP-serveren.

## Noter

- Brug `ListMcpResources` først, hvis du ikke ved, hvilke ressourcer en server eksponerer; brug `ReadMcpResourceDir` til mappeagtige lister.
- URI-skemaet er serverspecifikt (`file://`, `https://`, brugerdefinerede skemaer) — tjek, hvad målserveren annoncerer.
