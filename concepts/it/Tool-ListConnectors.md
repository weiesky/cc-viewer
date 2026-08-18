# ListConnectors

Elenca i connector MCP installati per l'organizzazione claude.ai dell'utente, opzionalmente filtrati per parola chiave.

## Quando usare

- Devi sapere quali connector sono già installati prima di suggerirne di nuovi.
- L'utente chiede quali integrazioni ha la sua organizzazione.

## Parametri

- `keywords` (array of strings, opzionale): Filtra l'elenco — fino a 8 elementi, ciascuno di 1–64 caratteri. Ometti per elencare tutto.

## Esempi

### Esempio 1: Elencare tutti i connector installati

```
ListConnectors()
```

### Esempio 2: Filtrare per parola chiave

```
ListConnectors(keywords=["github"])
```

## Note

- Disponibile solo nelle sessioni remote (claude.ai) sull'API first-party.
- Abbina con `SearchMcpRegistry` (scoperta) e `SuggestConnectors` (dettagli) per il flusso completo trova-e-abilita.
