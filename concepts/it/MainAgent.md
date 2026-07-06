# MainAgent

## Definizione

MainAgent è la catena di richieste principale di Claude Code quando non è in modalità agent team. Ogni interazione dell'utente con Claude Code genera una serie di richieste API, tra cui le richieste MainAgent costituiscono la catena di conversazione principale — trasportano il system prompt completo, le definizioni degli strumenti e la cronologia dei messaggi.

## Metodo di identificazione

In cc-viewer, MainAgent è identificato tramite `req.mainAgent === true`, contrassegnato automaticamente da `interceptor.js` al momento della cattura della richiesta.

Condizioni di determinazione (tutte devono essere soddisfatte):
- Il corpo della richiesta contiene il campo `system` (system prompt)
- Il corpo della richiesta contiene l'array `tools` (definizioni degli strumenti)
- Il system prompt contiene il testo caratteristico "Claude Code"

## Differenze rispetto al SubAgent

| Caratteristica | MainAgent | SubAgent |
|------|-----------|----------|
| system prompt | Prompt principale completo di Claude Code | Prompt semplificato specifico per il task |
| Array tools | Contiene tutti gli strumenti disponibili | Solitamente contiene solo i pochi strumenti necessari per il task |
| Cronologia messaggi | Accumula il contesto completo della conversazione | Contiene solo i messaggi relativi al sotto-task |
| Comportamento cache | Ha prompt caching (TTL di 5 minuti) | Solitamente senza cache o con cache ridotta |
