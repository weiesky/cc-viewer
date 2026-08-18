# SuggestConnectors

Risolve i payload completi dei connector per i valori `directoryUuid` restituiti da `SearchMcpRegistry`, così che all'utente possano essere offerti connector concreti da abilitare.

## Quando usare

- Dopo che `SearchMcpRegistry` restituisce connector candidati, per recuperarne i dettagli completi per la presentazione.

## Attivazione

- Disponibile solo nelle sessioni remote (claude.ai) sull'API first-party.

## Parametri

- `uuids` (array of strings, obbligatorio): Valori `directoryUuid` o `server_id` da risolvere. 1–32 elementi, ciascuno di 1–64 caratteri.

## Esempi

### Esempio 1: Risolvere due risultati del registry

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## Note

- Non indovinare mai gli UUID — risolvi solo gli identificatori che sono tornati da `SearchMcpRegistry`.
- Il tool non connette nulla di per sé; l'abilitazione di un connector avviene fuori banda.
