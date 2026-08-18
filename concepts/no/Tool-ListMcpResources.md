# ListMcpResources

Lister ressursene eksponert av tilkoblede MCP-servere, eventuelt filtrert til én server.

## Når skal den brukes

- Du må oppdage hvilke ressurser (filer, poster, dokumenter) en MCP-server tilbyr før du leser dem.
- Du vil ha en oversikt over alle ressurser på tvers av alle tilkoblede servere.

## Parametere

- `server` (string, valgfri): Servernavn å filtrere ressurser etter. Utelat for å liste ressurser fra alle tilkoblede servere.

## Eksempler

### Eksempel 1: List alt

```
ListMcpResources()
```

### Eksempel 2: List én servers ressurser

```
ListMcpResources(server="github")
```

## Notater

- Dette er oppdagelsestrinnet: mat interessante URI-er inn i `ReadMcpResource` (enkeltressurs) eller `ReadMcpResourceDir` (katalog-lister).
- Servere kobler til og fra gjennom sesjonens levetid; list på nytt hvis en server nettopp ble lagt til.
