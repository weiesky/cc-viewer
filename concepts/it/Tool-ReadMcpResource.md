# ReadMcpResource

Legge una singola risorsa esposta da un server MCP (Model Context Protocol) connesso, indirizzata tramite la sua URI.

## Quando usare

- Un server MCP pubblicizza una risorsa (file, record, documento) il cui contenuto ti serve nel contesto.
- Hai una URI di risorsa concreta — da `ListMcpResources`, dalla documentazione del server, o da un risultato di tool precedente.

## Attivazione

- Sempre abilitato, ma non esposto all'elenco degli strumenti del modello — pensato per l'uso thin-client / sidecar.

## Parametri

- `server` (string, obbligatorio): Il nome del server MCP.
- `uri` (string, obbligatorio): La URI della risorsa da leggere.

## Esempi

### Esempio 1: Leggere una risorsa del server tramite URI

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

Restituisce il contenuto della risorsa come fornito dal server MCP `github`.

## Note

- Usa prima `ListMcpResources` se non sai quali risorse espone un server; usa `ReadMcpResourceDir` per elenchi in stile directory.
- Lo schema della URI è specifico del server (`file://`, `https://`, schemi personalizzati) — controlla cosa pubblicizza il server di destinazione.
