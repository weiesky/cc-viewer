# ReadMcpResource

Leser én enkelt ressurs eksponert av en tilkoblet MCP-server (Model Context Protocol), adressert ved sin URI.

## Når skal den brukes

- En MCP-server annonserer en ressurs (fil, post, dokument) hvis innhold du trenger i konteksten.
- Du har en konkret ressurs-URI — fra `ListMcpResources`, fra serverens dokumentasjon eller fra et tidligere verktøyresultat.

## Aktivering

- Alltid aktivert, men ikke eksponert for modellens verktøyliste — ment for thin-client / sidecar-bruk.

## Parametere

- `server` (string, påkrevd): MCP-servernavnet.
- `uri` (string, påkrevd): Ressurs-URI-en som skal leses.

## Eksempler

### Eksempel 1: Les en serverressurs ved URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Returnerer ressursinnholdet slik `github` MCP-serveren leverer det.

## Notater

- Bruk `ListMcpResources` først hvis du ikke vet hvilke ressurser en server eksponerer; bruk `ReadMcpResourceDir` for katalog-aktige lister.
- URI-skjemaet er serverspesifikt (`file://`, `https://`, egendefinerte skjemaer) — sjekk hva målserveren annonserer.
