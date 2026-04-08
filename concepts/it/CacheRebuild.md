# Cache Rebuild (ricostruzione della cache)

## Contesto

Il meccanismo di prompt caching di Anthropic concatena in sequenza system → tools → messages (fino al cache breakpoint) della richiesta come chiave di cache. Quando la chiave di cache corrisponde esattamente alla richiesta precedente, l'API restituisce `cache_read_input_tokens` (cache hit); quando la chiave di cache cambia, l'API ricrea la cache, restituendo un gran numero di `cache_creation_input_tokens`, ovvero una ricostruzione della cache.

La ricostruzione della cache comporta costi aggiuntivi di token (il prezzo della cache creation è superiore a quello della cache read), pertanto identificare la causa della ricostruzione ha un valore diretto per l'ottimizzazione dei costi.

## Classificazione delle cause di ricostruzione della cache

cc-viewer confronta i body di due richieste MainAgent consecutive per determinare con precisione la causa della ricostruzione della cache:

| reason | Significato | Metodo di determinazione |
|--------|------|----------|
| `ttl` | Cache scaduta | Sono trascorsi più di 5 minuti dall'ultima richiesta MainAgent |
| `system_change` | Modifica del system prompt | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Modifica delle definizioni degli strumenti | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Cambio di modello | `prev.model !== curr.model` |
| `msg_truncated` | Stack dei messaggi troncato | Il numero di messaggi della richiesta corrente è inferiore a quello della richiesta precedente, solitamente causato dal troncamento per overflow della finestra di contesto |
| `msg_modified` | Modifica dei messaggi storici | Il contenuto dei messaggi prefisso non è coerente (durante l'accodamento normale il prefisso dovrebbe essere identico) |
| `key_change` | Modifica di chiave sconosciuta | Fallback quando nessuna delle condizioni precedenti corrisponde |

## Priorità di determinazione

1. Prima si controlla l'intervallo di tempo — se supera i 5 minuti, si determina direttamente `ttl`, senza confronto del body
2. Poi si controllano in sequenza model, system, tools, messages
3. Una richiesta può corrispondere a più cause contemporaneamente (es. cambio di modello + modifica del system prompt); in tal caso l'array `reasons` contiene tutti gli elementi corrispondenti e il tooltip li mostra su righe separate

## Scenari comuni

- **`ttl`**: l'utente ha interrotto le operazioni per più di 5 minuti e poi ha ripreso, la cache è scaduta naturalmente
- **`system_change`**: Claude Code ha aggiornato il system prompt (es. caricamento di un nuovo CLAUDE.md, modifica delle project instructions)
- **`tools_change`**: la connessione/disconnessione di un MCP server ha causato una modifica della lista degli strumenti disponibili
- **`model_change`**: l'utente ha cambiato modello tramite il comando `/model`
- **`msg_truncated`**: una conversazione troppo lunga ha attivato la gestione della finestra di contesto, Claude Code ha troncato i messaggi precedenti
- **`msg_modified`**: Claude Code ha modificato i messaggi storici (es. `/compact` ha sostituito i messaggi originali con un riepilogo compresso)
