# ReadMcpResourceDir

Elenca le voci di una risorsa in stile directory esposta da un server MCP connesso, indirizzata tramite la sua URI.

## Quando usare

- Un server MCP organizza le risorse gerarchicamente e devi enumerare un livello di quella gerarchia.
- Vuoi navigare prima di leggere singole risorse con `ReadMcpResource`.

## Attivazione

- Sempre abilitato, ma non esposto all'elenco degli strumenti del modello — pensato per l'uso thin-client / sidecar.

## Parametri

- `server` (string, obbligatorio): Il nome del server MCP.
- `uri` (string, obbligatorio): La URI della risorsa directory da elencare.

## Esempi

### Esempio 1: Elencare una directory di risorse

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

Restituisce le voci figlie che il server espone sotto quella URI di directory.

## Note

- Solo i server che modellano le proprie risorse come directory lo supportano; i server piatti restituiranno un errore o un elenco vuoto — ripiega su `ListMcpResources`.
- Combina con `ReadMcpResource` per approfondire le voci che sembrano rilevanti.
