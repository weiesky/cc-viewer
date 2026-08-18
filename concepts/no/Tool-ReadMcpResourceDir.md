# ReadMcpResourceDir

Lister oppføringene i en katalog-aktig ressurs eksponert av en tilkoblet MCP-server, adressert ved sin URI.

## Når skal den brukes

- En MCP-server organiserer ressurser hierarkisk, og du trenger å oppgi ett nivå av det hierarkiet.
- Du vil bla før du leser enkeltressurser med `ReadMcpResource`.

## Parametere

- `server` (string, påkrevd): MCP-servernavnet.
- `uri` (string, påkrevd): Katalogressurs-URI-en som skal listes.

## Eksempler

### Eksempel 1: List en ressurskatalog

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Returnerer barneoppføringene serveren eksponerer under den katalog-URI-en.

## Notater

- Kun servere som modellerer ressursene sine som kataloger støtter dette; flate servere returnerer en feil eller en tom liste — fall tilbake til `ListMcpResources`.
- Kombiner med `ReadMcpResource` for å bore ned i oppføringene som ser relevante ut.
