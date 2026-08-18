# ListMcpResources

Lister de ressourcer, der eksponeres af forbundne MCP-servere, eventuelt filtreret til én server.

## Hvornår skal den bruges

- Du har brug for at opdage, hvilke ressourcer (filer, poster, dokumenter) en MCP-server tilbyder, før du læser dem.
- Du vil have et overblik over alle ressourcer på tværs af enhver forbundet server.

## Parametre

- `server` (string, valgfri): Servernavn at filtrere ressourcer efter. Udelad for at liste ressourcer fra alle forbundne servere.

## Eksempler

### Eksempel 1: List alt

```
ListMcpResources()
```

### Eksempel 2: List én servers ressourcer

```
ListMcpResources(server="github")
```

## Noter

- Dette er opdagelsestrinnet: før interessante URI'er ind i `ReadMcpResource` (enkelt resource) eller `ReadMcpResourceDir` (mappelister).
- Servere forbinder og afbryder over sessionens levetid; list igen, hvis en server lige blev tilføjet.
