# SearchMcpRegistry

Cerca nel registry dei connector MCP per parola chiave per scoprire connector che potrebbero aiutare a completare il compito.

## Quando usare

- Il compito trarrebbe beneficio da un servizio esterno (un database, un issue tracker, un'API SaaS) e vuoi verificare se esiste un connector MCP per esso.
- L'utente nomina un prodotto e chiede di connetterlo — cerca nel registry un connector corrispondente.

## Attivazione

- Disponibile solo nelle sessioni remote (claude.ai) sull'API first-party.

## Parametri

- `keywords` (array of strings, obbligatorio): Frasi chiave che descrivono l'intento dell'utente o un prodotto nominato. 1–8 elementi, ciascuno di 1–64 caratteri.

## Esempi

### Esempio 1: Trovare un connector per un prodotto nominato

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

Restituisce le voci del registry i cui connector corrispondono alle parole chiave. Risolvi i dettagli completi del connector con `SuggestConnectors`.

## Note

- In sola lettura e sicuro per la concorrenza; i risultati hanno una dimensione massima.
- La ricerca non installa nulla — è pura scoperta.
