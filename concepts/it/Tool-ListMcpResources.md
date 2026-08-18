# ListMcpResources

Elenca le risorse esposte dai server MCP connessi, opzionalmente filtrate a un singolo server.

## Quando usare

- Devi scoprire quali risorse (file, record, documenti) offre un server MCP prima di leggerle.
- Vuoi una panoramica di tutte le risorse su ogni server connesso.

## Attivazione

- Sempre abilitato, ma non esposto all'elenco degli strumenti del modello — pensato per l'uso thin-client / sidecar.

## Parametri

- `server` (string, opzionale): Nome del server per filtrare le risorse. Ometti per elencare le risorse di tutti i server connessi.

## Esempi

### Esempio 1: Elencare tutto

```
ListMcpResources()
```

### Esempio 2: Elencare le risorse di un server

```
ListMcpResources(server="github")
```

## Note

- Questo è il passo di scoperta: passa le URI interessanti a `ReadMcpResource` (singola risorsa) o `ReadMcpResourceDir` (elenchi di directory).
- I server si connettono e si disconnettono durante la vita della sessione; ri-elenca se un server è stato appena aggiunto.
